using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.RandomDraws.Domain;

public sealed record EligibleMember(Guid MembershipId, int SlotNumber);
public sealed record RandomDrawProof(string AlgorithmVersion, Guid GroupId, Guid CycleId, int CycleNumber,
    IReadOnlyList<EligibleMember> CanonicalEligibleMembers, string EligibleSetHash, string SeedCommitment, string SeedReveal,
    int SelectedIndex, Guid WinnerMembershipId, string ResultHash);
public sealed record DrawVerification(bool Valid, string? FailureReason);

// Immutable historical specification. Any change to these bytes/mapping requires a NEW version.
public static class RandomDrawV1
{
    public const string AlgorithmVersion = "DHANVI_RANDOM_V1";
    public static IReadOnlyList<EligibleMember> CanonicalMembers(IEnumerable<EligibleMember> members)
    {
        var ordered = members.OrderBy(m => m.SlotNumber).ToArray();
        BusinessRuleException.Require(ordered.Length is >= 1 and <= 50, "NO_ELIGIBLE_MEMBERS", "The eligible set must contain between one and fifty memberships.");
        BusinessRuleException.Require(ordered.All(m => m.MembershipId != Guid.Empty && m.SlotNumber is >= 1 and <= 50) && ordered.Select(m => m.MembershipId).Distinct().Count() == ordered.Length && ordered.Select(m => m.SlotNumber).Distinct().Count() == ordered.Length,
            "INVALID_ELIGIBLE_SET", "Eligible memberships must have unique IDs and valid unique slots.");
        return ordered;
    }
    public static string CanonicalPayload(Guid groupId, Guid cycleId, int number, IEnumerable<EligibleMember> members)
    {
        BusinessRuleException.Require(groupId != Guid.Empty && cycleId != Guid.Empty && number is >= 1 and <= 50, "INVALID_DRAW_IDENTIFIERS", "Valid group, cycle, and cycle number are required.");
        return $"{AlgorithmVersion}\n{Id(groupId)}\n{Id(cycleId)}\n{Number(number)}\n" + string.Join('\n', CanonicalMembers(members).Select(m => $"{Id(m.MembershipId)}:{Number(m.SlotNumber)}")) + "\n";
    }
    public static RandomDrawProof Draw(Guid groupId, Guid cycleId, int number, IEnumerable<EligibleMember> members, byte[] seed)
    {
        BusinessRuleException.Require(seed.Length == 32, "INVALID_RANDOM_SEED", "The seed must contain exactly 32 bytes.");
        var ordered = CanonicalMembers(members); var eligibleHash = Hash(Encoding.UTF8.GetBytes(CanonicalPayload(groupId, cycleId, number, ordered)));
        var commitment = Hash(seed); var reveal = Hex(seed); var index = SelectIndex(seed, groupId, cycleId, number, eligibleHash, ordered.Count);
        var winner = ordered[index].MembershipId;
        var resultHash = Hash(Encoding.UTF8.GetBytes(ResultPayload(groupId, cycleId, number, eligibleHash, commitment, reveal, index, winner)));
        return new(AlgorithmVersion, groupId, cycleId, number, ordered, eligibleHash, commitment, reveal, index, winner, resultHash);
    }
    public static int SelectIndex(byte[] seed, Guid groupId, Guid cycleId, int number, string eligibleSetHash, int count)
    {
        BusinessRuleException.Require(seed.Length == 32 && count is >= 1 and <= 50, "INVALID_DRAW_INPUT", "Invalid seed or eligible count.");
        for (ulong counter = 0; ; counter++)
        {
            var context = Encoding.UTF8.GetBytes($"{AlgorithmVersion}\n{Id(groupId)}\n{Id(cycleId)}\n{Number(number)}\n{eligibleSetHash}\n{counter.ToString(CultureInfo.InvariantCulture)}\n");
            var material = new byte[seed.Length + context.Length]; seed.CopyTo(material, 0); context.CopyTo(material, seed.Length);
            var digest = SHA256.HashData(material); var candidate = BinaryPrimitives.ReadUInt64BigEndian(digest);
            if (TryMap(candidate, count, out var index)) return index;
            if (counter == ulong.MaxValue) throw new BusinessRuleException("RANDOM_MAPPING_FAILED", "Random mapping exhausted its counter.");
        }
    }
    // Reject the first 2^64 mod count possible values; the remaining range is divisible by count.
    public static bool TryMap(ulong candidate, int count, out int index)
    {
        BusinessRuleException.Require(count is >= 1 and <= 50, "INVALID_ELIGIBLE_SET", "Invalid eligible count.");
        var bound = (ulong)count; var threshold = unchecked(0UL - bound) % bound;
        index = -1; if (candidate < threshold) return false; index = (int)(candidate % bound); return true;
    }
    public static string ResultPayload(Guid groupId, Guid cycleId, int number, string eligibleHash, string commitment, string reveal, int index, Guid winner) =>
        $"DHANVI_RANDOM_RESULT_V1\n{AlgorithmVersion}\n{Id(groupId)}\n{Id(cycleId)}\n{Number(number)}\n{eligibleHash}\n{commitment}\n{reveal}\n{Number(index)}\n{Id(winner)}\n";
    public static string Hash(byte[] bytes) => Hex(SHA256.HashData(bytes));
    private static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
    private static string Id(Guid id) => id.ToString("D", CultureInfo.InvariantCulture);
    private static string Number(int number) => number.ToString(CultureInfo.InvariantCulture);
}

public static class RandomDrawVerifier
{
    public static DrawVerification Verify(RandomDrawProof proof)
    {
        if (proof.AlgorithmVersion != RandomDrawV1.AlgorithmVersion) return new(false, "UNSUPPORTED_ALGORITHM_VERSION");
        try
        {
            var ordered = RandomDrawV1.CanonicalMembers(proof.CanonicalEligibleMembers);
            if (!ordered.SequenceEqual(proof.CanonicalEligibleMembers)) return new(false, "SNAPSHOT_NOT_CANONICAL");
            var calculated = RandomDrawV1.Draw(proof.GroupId, proof.CycleId, proof.CycleNumber, ordered, Convert.FromHexString(proof.SeedReveal));
            if (calculated.EligibleSetHash != proof.EligibleSetHash) return new(false, "ELIGIBLE_SET_HASH_MISMATCH");
            if (calculated.SeedCommitment != proof.SeedCommitment || calculated.SeedReveal != proof.SeedReveal) return new(false, "SEED_COMMITMENT_MISMATCH");
            if (calculated.SelectedIndex != proof.SelectedIndex || calculated.WinnerMembershipId != proof.WinnerMembershipId) return new(false, "WINNER_MISMATCH");
            if (calculated.ResultHash != proof.ResultHash) return new(false, "RESULT_HASH_MISMATCH");
            return new(true, null);
        }
        catch (Exception error) when (error is FormatException or ArgumentException or BusinessRuleException or NullReferenceException)
        {
            return new(false, "INVALID_VERIFICATION_MATERIAL");
        }
    }
}
