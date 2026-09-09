using System.Globalization;
using System.Text;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.RandomDraws.Domain;

public sealed class SelectionResult
{
    private readonly List<SelectionEligibleMember> _eligibleMembers = [];
    private SelectionResult() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public Guid CycleId { get; private set; }
    public int CycleNumber { get; private set; }
    public SelectionMethod SelectionMethod { get; private set; }
    public Guid WinnerMembershipId { get; private set; }
    public Guid WinnerUserId { get; private set; }
    public int WinnerSlotNumber { get; private set; }
    public int EligibleMemberCount { get; private set; }
    public DateTimeOffset ExecutedAt { get; private set; }
    public Guid ExecutedByUserId { get; private set; }
    public string AlgorithmVersion { get; private set; } = "";
    public string? RandomSourceType { get; private set; }
    public string? SeedCommitment { get; private set; }
    public string? SeedReveal { get; private set; }
    public string? EligibleSetHash { get; private set; }
    public string ResultHash { get; private set; } = "";
    public int? SelectedIndex { get; private set; }
    public IReadOnlyCollection<SelectionEligibleMember> EligibleMembers => _eligibleMembers.AsReadOnly();
    public static SelectionResult Random(RandomDrawProof proof, Guid winnerUserId, Guid actor, DateTimeOffset now, string sourceType)
    {
        BusinessRuleException.Require(RandomDrawVerifier.Verify(proof).Valid, "SELECTION_VERIFICATION_FAILED", "Generated verification material is invalid.");
        var result = new SelectionResult { GroupId = proof.GroupId, CycleId = proof.CycleId, CycleNumber = proof.CycleNumber, SelectionMethod = SelectionMethod.Random,
            WinnerMembershipId = proof.WinnerMembershipId, WinnerUserId = winnerUserId, WinnerSlotNumber = proof.CanonicalEligibleMembers[proof.SelectedIndex].SlotNumber,
            EligibleMemberCount = proof.CanonicalEligibleMembers.Count, ExecutedAt = now, ExecutedByUserId = actor, AlgorithmVersion = proof.AlgorithmVersion, RandomSourceType = sourceType,
            SeedCommitment = proof.SeedCommitment, SeedReveal = proof.SeedReveal, EligibleSetHash = proof.EligibleSetHash, ResultHash = proof.ResultHash, SelectedIndex = proof.SelectedIndex };
        result.Snapshot(proof.CanonicalEligibleMembers); return result;
    }
    public static SelectionResult Reserved(Guid groupId, Guid cycleId, int number, EligibleMember organizer, Guid userId, Guid actor, DateTimeOffset now)
    {
        BusinessRuleException.Require(number == 1, "INVALID_ORGANIZER_RESERVED_CYCLE", "Organizer reservation applies only to cycle 1.");
        var payload = string.Join('\n', "ORGANIZER_RESERVED_V1", groupId.ToString("D"), cycleId.ToString("D"), "1", organizer.MembershipId.ToString("D"), organizer.SlotNumber.ToString(CultureInfo.InvariantCulture)) + "\n";
        var result = new SelectionResult { GroupId = groupId, CycleId = cycleId, CycleNumber = number, SelectionMethod = SelectionMethod.OrganizerReserved,
            WinnerMembershipId = organizer.MembershipId, WinnerUserId = userId, WinnerSlotNumber = organizer.SlotNumber, EligibleMemberCount = 1, ExecutedAt = now, ExecutedByUserId = actor,
            AlgorithmVersion = "ORGANIZER_RESERVED_V1", ResultHash = RandomDrawV1.Hash(Encoding.UTF8.GetBytes(payload)) };
        result.Snapshot([organizer]); return result;
    }
    public static SelectionResult Auction(Guid groupId, Guid cycleId, int number, EligibleMember winner, Guid userId, Guid actor,
        DateTimeOffset now, IReadOnlyList<EligibleMember> eligible, Guid winningBidId)
    {
        var members = RandomDrawV1.CanonicalMembers(eligible);
        BusinessRuleException.Require(members.Contains(winner), "MEMBER_NOT_ELIGIBLE_TO_BID", "Winning membership must be in the eligible selection snapshot.");
        var payload = string.Join('\n', "DHANVI_AUCTION_V1", groupId.ToString("D"), cycleId.ToString("D"), number.ToString(CultureInfo.InvariantCulture), winningBidId.ToString("D"), winner.MembershipId.ToString("D")) + "\n";
        var result = new SelectionResult { GroupId = groupId, CycleId = cycleId, CycleNumber = number, SelectionMethod = SelectionMethod.Auction,
            WinnerMembershipId = winner.MembershipId, WinnerUserId = userId, WinnerSlotNumber = winner.SlotNumber, EligibleMemberCount = members.Count,
            ExecutedAt = now, ExecutedByUserId = actor, AlgorithmVersion = "DHANVI_AUCTION_V1", ResultHash = RandomDrawV1.Hash(Encoding.UTF8.GetBytes(payload)) };
        result.Snapshot(members); return result;
    }
    public RandomDrawProof Proof()
    {
        BusinessRuleException.Require(SelectionMethod == SelectionMethod.Random, "RANDOM_VERIFICATION_NOT_APPLICABLE", "This selection method does not use random verification.");
        return new(AlgorithmVersion, GroupId, CycleId, CycleNumber, EligibleMembers.OrderBy(m => m.Ordinal).Select(m => new EligibleMember(m.MembershipId, m.SlotNumber)).ToArray(), EligibleSetHash!, SeedCommitment!, SeedReveal!, SelectedIndex!.Value, WinnerMembershipId, ResultHash);
    }
    private void Snapshot(IReadOnlyList<EligibleMember> members)
    {
        for (var ordinal = 0; ordinal < members.Count; ordinal++) _eligibleMembers.Add(new(Id, GroupId, members[ordinal].MembershipId, members[ordinal].SlotNumber, ordinal));
    }
}
public sealed class SelectionEligibleMember(Guid selectionResultId, Guid groupId, Guid membershipId, int slotNumber, int ordinal)
{
    public Guid SelectionResultId { get; private set; } = selectionResultId;
    public Guid GroupId { get; private set; } = groupId;
    public Guid MembershipId { get; private set; } = membershipId;
    public int SlotNumber { get; private set; } = slotNumber;
    public int Ordinal { get; private set; } = ordinal;
}
