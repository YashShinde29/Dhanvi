using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.Modules.RandomDraws.Domain;
using Dhanvi.Modules.RandomDraws.Infrastructure;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.UnitTests.RandomDraws;

public sealed class RandomDrawTests
{
    private static readonly Guid GroupId = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid CycleId = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly byte[] Seed = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();
    private static readonly EligibleMember[] Members = [new(Guid.Parse("00000000-0000-0000-0000-000000000011"), 1), new(Guid.Parse("00000000-0000-0000-0000-000000000012"), 2), new(Guid.Parse("00000000-0000-0000-0000-000000000013"), 3)];
    private static RandomDrawProof Proof() => RandomDrawV1.Draw(GroupId, CycleId, 1, Members, Seed);
    [Fact] public void CanonicalSerializationAndIndependentGoldenHashesAreStable()
    {
        Assert.Equal("DHANVI_RANDOM_V1\n00000000-0000-0000-0000-000000000001\n00000000-0000-0000-0000-000000000002\n1\n00000000-0000-0000-0000-000000000011:1\n00000000-0000-0000-0000-000000000012:2\n00000000-0000-0000-0000-000000000013:3\n", RandomDrawV1.CanonicalPayload(GroupId, CycleId, 1, Members.Reverse()));
        var proof = Proof(); Assert.Equal("c22338f049f733b3904ad20b9a4947ced507cd41fadeac79c100d723afd1ecb3", proof.EligibleSetHash); Assert.Equal("630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd", proof.SeedCommitment);
        Assert.Equal(1, proof.SelectedIndex); Assert.Equal(Members[1].MembershipId, proof.WinnerMembershipId); Assert.Equal("f98c26f97cbbe567f1fc758bf7b6d00f47f0bb2c139ba61b6b1f5108e2ecd885", proof.ResultHash);
    }
    [Fact] public void SameSeedAndSnapshotReproduceResult() => Assert.Equal(Proof().ResultHash, RandomDrawV1.Draw(GroupId, CycleId, 1, Members.Reverse(), Seed).ResultHash);
    [Fact] public void DeterministicTestSeedsProduceDifferentValidWinners()
    {
        var proofs = Enumerable.Range(0, 32).Select(i => RandomDrawV1.Draw(GroupId, CycleId, 1, Members, Enumerable.Repeat((byte)i, 32).ToArray())).ToArray();
        Assert.True(proofs.Select(p => p.WinnerMembershipId).Distinct().Count() > 1); Assert.All(proofs, p => Assert.True(RandomDrawVerifier.Verify(p).Valid));
    }
    [Fact] public void SecureProductionSourceProducesRequiredSeedSize() { var source = new CryptographicRandomSource(); Assert.Equal("DOTNET_RANDOM_NUMBER_GENERATOR", source.SourceType); Assert.Equal(32, source.CreateSeed().Length); }
    [Fact] public void RejectionSamplingRejectsBiasedPrefix() { Assert.False(RandomDrawV1.TryMap(0, 3, out _)); Assert.True(RandomDrawV1.TryMap(1, 3, out var index)); Assert.Equal(1, index); Assert.True(RandomDrawV1.TryMap(ulong.MaxValue, 3, out index)); Assert.Equal(0, index); }
    [Theory] [InlineData(1)] [InlineData(2)] [InlineData(20)] [InlineData(50)] public void MappingAlwaysReturnsValidIndexForAcceptedValues(int count) { foreach (var candidate in new[] { 100UL, 1000UL, ulong.MaxValue }) { Assert.True(RandomDrawV1.TryMap(candidate, count, out var i)); Assert.InRange(i, 0, count - 1); } }
    [Fact] public void SingleMemberHasConsistentProof() { var proof = RandomDrawV1.Draw(GroupId, CycleId, 20, [Members[0]], Seed); Assert.Equal(0, proof.SelectedIndex); Assert.True(RandomDrawVerifier.Verify(proof).Valid); }
    [Fact] public void EmptySetFails() => Assert.Throws<BusinessRuleException>(() => RandomDrawV1.Draw(GroupId, CycleId, 1, [], Seed));
    [Fact] public void DuplicateMembersOrSlotsFail() { Assert.Throws<BusinessRuleException>(() => RandomDrawV1.CanonicalMembers([Members[0], Members[0]])); Assert.Throws<BusinessRuleException>(() => RandomDrawV1.CanonicalMembers([Members[0], Members[1] with { SlotNumber = 1 }])); }
    [Fact] public void ModifiedSeedFailsVerification() => Assert.False(RandomDrawVerifier.Verify(Proof() with { SeedReveal = new string('0', 64) }).Valid);
    [Fact] public void ModifiedSnapshotFailsVerification() => Assert.False(RandomDrawVerifier.Verify(Proof() with { CanonicalEligibleMembers = [Members[0], Members[1]] }).Valid);
    [Fact] public void ModifiedWinnerFailsVerification() => Assert.False(RandomDrawVerifier.Verify(Proof() with { WinnerMembershipId = Members[0].MembershipId }).Valid);
    [Fact] public void ModifiedHashFailsVerification() => Assert.False(RandomDrawVerifier.Verify(Proof() with { ResultHash = new string('0', 64) }).Valid);
    [Fact] public void MalformedSeedFailsSafely() => Assert.False(RandomDrawVerifier.Verify(Proof() with { SeedReveal = "not-hex" }).Valid);
    [Fact] public void UnknownAlgorithmFailsSafely() => Assert.False(RandomDrawVerifier.Verify(Proof() with { AlgorithmVersion = "DHANVI_RANDOM_V2" }).Valid);
    [Fact] public void ReorderedPersistedSnapshotIsRejected() => Assert.False(RandomDrawVerifier.Verify(Proof() with { CanonicalEligibleMembers = Members.Reverse().ToArray() }).Valid);
    [Fact] public void ResultPersistsExactSnapshotAndHasNoMutationMethods()
    {
        var result = SelectionResult.Random(Proof(), Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UnixEpoch, "DETERMINISTIC_TEST"); Assert.Equal(Members, result.EligibleMembers.OrderBy(m => m.Ordinal).Select(m => new EligibleMember(m.MembershipId, m.SlotNumber))); Assert.True(RandomDrawVerifier.Verify(result.Proof()).Valid);
        Assert.All(typeof(SelectionResult).GetProperties(), p => Assert.False(p.SetMethod?.IsPublic == true)); Assert.All(typeof(SelectionEligibleMember).GetProperties(), p => Assert.False(p.SetMethod?.IsPublic == true));
    }
    [Fact] public void ReservedResultHasNoRandomVerification() { var result = SelectionResult.Reserved(GroupId, CycleId, 1, Members[0], Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UnixEpoch); Assert.Null(result.SeedReveal); Assert.Equal("ORGANIZER_RESERVED_V1", result.AlgorithmVersion); Assert.Throws<BusinessRuleException>(() => result.Proof()); Assert.Throws<BusinessRuleException>(() => SelectionResult.Reserved(GroupId, CycleId, 2, Members[0], Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UnixEpoch)); }
    [Fact] public void EligibilityExcludesPriorWinnersAndInvalidAccounts()
    {
        var state = ReadyContext(); var prior = state.Participants[0].Membership; prior.SelectForPayout(1, DateTimeOffset.UtcNow);
        var updated = state with { Participants = state.Participants.Select((p, index) => index == 1 ? p with { UserActive = false } : p).ToArray() };
        var eligible = SelectionPolicy.Eligible(updated); Assert.Equal(18, eligible.Count); Assert.DoesNotContain(eligible, p => p.Membership.Id == prior.Id); Assert.Equal(eligible.OrderBy(p => p.Membership.SlotNumber), eligible);
    }
    [Fact] public void OrganizerReservedRequiresParticipatingUnselectedOrganizer() { var state = ReadyContext(true); var organizer = SelectionPolicy.ReservedOrganizer(state); Assert.Equal(state.Group.CreatedByUserId, organizer.Membership.UserId); organizer.Membership.SelectForPayout(1, DateTimeOffset.UtcNow); Assert.Throws<BusinessRuleException>(() => SelectionPolicy.ReservedOrganizer(state)); }
    [Fact] public void MissingOrganizerMembershipFails() { var state = ReadyContext(true); Assert.Throws<BusinessRuleException>(() => SelectionPolicy.ReservedOrganizer(state with { Participants = state.Participants.Skip(1).ToArray() })); }
    [Fact] public void NoReservedRuleFails() => Assert.Throws<BusinessRuleException>(() => SelectionPolicy.ReservedOrganizer(ReadyContext()));
    [Fact] public void ShortfallIsRecheckedBeforeSelection() { var state = ReadyContext(); SelectionPolicy.RequireReady(state); Assert.Throws<BusinessRuleException>(() => SelectionPolicy.RequireReady(state with { Contributions = state.Contributions.Skip(1).ToArray() })); }
    [Fact] public void WinnerReceivesRightAndCycleStopsAtSelectionCompleted() { var state = ReadyContext(); var winner = state.Participants[0].Membership; winner.SelectForPayout(1, DateTimeOffset.UnixEpoch); state.Cycle.CompleteSelection(Guid.NewGuid(), DateTimeOffset.UnixEpoch); Assert.True(winner.HasBeenSelectedForPayout); Assert.Equal(1, winner.PayoutCycleNumber); Assert.Equal(CycleStatus.SelectionCompleted, state.Cycle.Status); Assert.NotNull(state.Cycle.SelectionCompletedAt); Assert.Throws<BusinessRuleException>(state.Cycle.EnsureReversalAllowed); Assert.All(state.Participants.Skip(1), p => Assert.False(p.Membership.HasBeenSelectedForPayout)); }
    private static SelectionContext ReadyContext(bool reserved = false)
    {
        var now = DateTimeOffset.UnixEpoch; var owner = Guid.NewGuid(); var group = Group.Create("Test", "", GroupCreatorType.Organizer, owner, new(GroupType.Random, 50000, 20, reserved, reserved, 1, 2, 2, new(2030, 1, 1)), true, now); var rules = group.Publish(true, now); var members = new List<SelectionParticipant>();
        for (var i = 0; i < 20; i++) { var m = GroupMembership.Apply(group.Id, reserved && i == 0 ? owner : Guid.NewGuid(), now); m.Approve(reserved && i == 0 ? 1 : group.ApproveMember(now), now); m.Accept(rules, now); members.Add(new(m, true, "Member")); }
        group.ConfirmReady(true, 20, true, now); group.Activate(20, true, true, false, now); foreach (var p in members) p.Membership.Activate(now); var cycle = CycleSchedule.Generate(group, now)[0];
        var obligations = members.Select(p => Contribution.Expect(group.Id, cycle.Id, p.Membership.Id, 2500, cycle.ContributionDueDate, now)).ToArray(); foreach (var c in obligations) c.Record(2500, "ref", null, "key", owner, new(1970, 1, 1), now); cycle.Recalculate(50000, 20, 20, now);
        return new(group, cycle, members, obligations, true, true, null);
    }
}
