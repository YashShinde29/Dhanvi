using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;

namespace Dhanvi.UnitTests.Auctions;

/// <summary>Rescheduling a SCHEDULED auction: authority, status gates, validation, history, idempotency, concurrency and stale-trigger safety.</summary>
public sealed class AuctionRescheduleTests
{
    private sealed class Clock : IDateTimeProvider { public DateTimeOffset UtcNow { get; set; } = new(2030, 1, 1, 6, 0, 0, TimeSpan.Zero); }
    private sealed class Store(AuctionContext state) : IAuctionStore
    {
        public Task<T> ReadAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> read, CancellationToken ct) => Task.FromResult(read(state));
        public Task<T> ExecuteLockedAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> execute, CancellationToken ct) => Task.FromResult(execute(state));
    }
    private sealed class Hook : IAuctionEventHook { public List<AuctionRescheduledEvent> Raised { get; } = []; public Task AuctionRescheduledAsync(AuctionRescheduledEvent notification, CancellationToken ct) { Raised.Add(notification); return Task.CompletedTask; } }
    /// <summary>In-memory stand-in for the paged reader: same newest-first order, paging and sanitization rules as the SQL implementation.</summary>
    private sealed class HistoryReader(AuctionContext state, Guid ownerId) : IAuctionScheduleHistoryReader
    {
        public Task<bool> OwnsGroupAsync(Guid groupId, Guid userId, CancellationToken ct) => Task.FromResult(userId == ownerId && state.Selection.Group.CreatorType == GroupCreatorType.Organizer);
        public Task<AuctionScheduleHistoryPage> ReadAsync(Guid groupId, Guid? cycleId, int page, int pageSize, bool includeInternal, CancellationToken ct)
        {
            var rows = state.ScheduleChanges.Where(c => c.GroupId == groupId && (cycleId is null || c.CycleId == cycleId)).OrderByDescending(c => c.ChangedAt).ThenByDescending(c => c.ChangeSequence).ToList();
            var items = rows.Skip((page - 1) * pageSize).Take(pageSize).Select(r => new AuctionScheduleChangeDetails(r.Id, r.CycleId, state.Selection.Cycle.CycleNumber, r.ChangeSequence, r.PreviousStartsAt, r.PreviousEndsAt, r.NewStartsAt, r.NewEndsAt,
                r.ReasonCode, includeInternal ? r.ReasonText : null, r.MemberMessage, includeInternal ? r.ChangedByRole : null, includeInternal ? "Name" : null, r.ChangedAt)).ToArray();
            return Task.FromResult(new AuctionScheduleHistoryPage(items, page, pageSize, rows.Count));
        }
    }
    private sealed class Scenario
    {
        public required AuctionContext State { get; init; }
        public required AuctionService Service { get; init; }
        public required Clock Clock { get; init; }
        public required Hook Hook { get; init; }
        public SelectionActor Owner => new(State.Selection.Group.CreatedByUserId, false);
        public static SelectionActor Admin => new(Guid.NewGuid(), true);
        public SelectionActor Member(int index = 0) => new(State.Selection.Participants[index].Membership.UserId, false);
        // Rule window is 10:00–11:00 UTC on the cycle's selection date (2 Jan 2030).
        public static DateTimeOffset RuleStart => new(2030, 1, 2, 10, 0, 0, TimeSpan.Zero);
        public Task<AuctionDetails> Get(SelectionActor? actor = null) => Service.GetAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Member(), default);
        public Task<AuctionDetails> Open(SelectionActor? actor = null) => Service.OpenAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Owner, default);
        public Task<AuctionDetails> Close() => Service.CloseAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, Owner, default);
        public Task<AuctionBidDetails> Bid(decimal amount = 150000, string key = "bid") => Service.BidAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, Member(), new(amount), key, default);
        public Task<AuctionDetails> Reschedule(DateTimeOffset start, DateTimeOffset? end = null, AuctionScheduleReason reason = AuctionScheduleReason.PublicHoliday, SelectionActor? actor = null, string key = "r1", int? expected = null, string? text = null, string? message = null) =>
            Service.RescheduleAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Owner, new(start, end ?? start.AddHours(1), reason, text, message, expected), key, default);
        public Task<AuctionScheduleHistoryPage> History(SelectionActor? actor = null, int page = 1, int pageSize = 5) => Service.ScheduleHistoryAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Owner, page, pageSize, default);
        public Task<AuctionScheduleHistoryPage> GroupHistory(SelectionActor? actor = null, Guid? cycleId = null, int page = 1, int pageSize = 20) => Service.GroupScheduleHistoryAsync(State.Selection.Group.Id, cycleId, actor ?? Owner, page, pageSize, default);
    }
    private static Scenario Create(GroupCreatorType creator = GroupCreatorType.Organizer, bool complete = true)
    {
        var now = new DateTimeOffset(2029, 1, 1, 0, 0, 0, TimeSpan.Zero); var owner = Guid.NewGuid();
        var group = Group.Create("Reschedule test", "", creator, owner, new(GroupType.Auction, 500000, 20, false, false, 1, 2, 2, new(2030, 1, 1), new(50000, 200000, 5000, new(10, 0), new(11, 0))), true, now);
        var rules = group.Publish(true, now); var participants = new List<SelectionParticipant>();
        for (var i = 0; i < 20; i++) { var m = GroupMembership.Apply(group.Id, Guid.NewGuid(), now); m.Approve(group.ApproveMember(now), now); m.Accept(rules, now); participants.Add(new(m, true, "Member")); }
        group.ConfirmReady(true, 20, true, now); group.Activate(20, true, true, false, now);
        foreach (var p in participants) p.Membership.Activate(now);
        var cycle = CycleSchedule.Generate(group, now)[0];
        var contributions = participants.Select(p => Contribution.Expect(group.Id, cycle.Id, p.Membership.Id, 25000, cycle.ContributionDueDate, now)).ToArray();
        foreach (var c in contributions.Take(complete ? 20 : 19)) c.Record(25000, "manual", null, "key", owner, new(2029, 1, 1), now);
        cycle.Recalculate(complete ? 500000 : 475000, complete ? 20 : 19, 20, now);
        var state = new AuctionContext(new(group, cycle, participants, contributions, true, true, null)); var clock = new Clock(); var hook = new Hook();
        return new() { State = state, Clock = clock, Hook = hook, Service = new(new Store(state), clock, null, hook, new HistoryReader(state, owner)) };
    }

    [Fact]
    public async Task OwningOrganizerReschedulesOwnScheduledAuctionAndHistoryKeepsTheOriginalWindow()
    {
        var s = Create(); var before = await s.Get(s.Owner);
        Assert.True(before.CanReschedule); Assert.False(before.WasRescheduled); Assert.Equal(0, before.ScheduleVersion); Assert.Null(s.State.Auction);
        var newStart = Scenario.RuleStart.AddDays(1).AddHours(3);
        var after = await s.Reschedule(newStart, expected: 0);
        Assert.Equal("SCHEDULED", after.Status); Assert.Equal(newStart, after.StartsAt); Assert.Equal(newStart.AddHours(1), after.EndsAt);
        Assert.True(after.WasRescheduled); Assert.Equal(1, after.RescheduleCount); Assert.Equal(s.Clock.UtcNow, after.LastRescheduledAt);
        Assert.Equal(Scenario.RuleStart, after.OriginalStartsAt); Assert.Equal(Scenario.RuleStart.AddHours(1), after.OriginalEndsAt);
        // The row now exists as SCHEDULED with the new authoritative window; the previous window lives only in history.
        var auction = Assert.IsType<Auction>(s.State.Auction); Assert.Equal(AuctionStatus.Scheduled, auction.Status); Assert.Equal(newStart, auction.StartsAt);
        var change = Assert.Single(s.State.ScheduleChanges);
        Assert.Equal((1, Scenario.RuleStart, Scenario.RuleStart.AddHours(1), newStart, newStart.AddHours(1), AuctionScheduleReason.PublicHoliday, "ORGANIZER", s.Owner.UserId), (change.ChangeSequence, change.PreviousStartsAt, change.PreviousEndsAt, change.NewStartsAt, change.NewEndsAt, change.ReasonCode, change.ChangedByRole, change.ChangedByUserId));
        // Latest-change summary is on the auction itself: no history read is needed to render it.
        Assert.Equal((Scenario.RuleStart, Scenario.RuleStart.AddHours(1), AuctionScheduleReason.PublicHoliday), (after.PreviousStartsAt, after.PreviousEndsAt, after.LatestReasonCode));
        Assert.Equal(["AUCTION_CREATED", "AUCTION_RESCHEDULED"], s.State.Audit.Select(a => a.Action)); Assert.Equal(change.Id, s.State.Audit[1].SubjectId);
        Assert.Single(s.State.Receipts); Assert.Equal(change.Id, s.State.Receipts[0].ResultId);
        var raised = Assert.Single(s.Hook.Raised); Assert.Equal((newStart, AuctionScheduleReason.PublicHoliday), (raised.NewStartsAt, raised.ReasonCode));
        var history = Assert.Single((await s.History()).Items); Assert.Equal(1, history.ChangeSequence);
    }

    [Theory]
    [InlineData(1, 0)]   // date only
    [InlineData(0, 2)]   // time only
    [InlineData(3, 5)]   // date + time
    public async Task ScheduledAuctionCanMoveDateTimeOrBoth(int days, int hours)
    {
        var s = Create(); var target = Scenario.RuleStart.AddDays(days).AddHours(hours);
        var after = await s.Reschedule(target, target.AddMinutes(90));
        Assert.Equal(target, after.StartsAt); Assert.Equal(target.AddMinutes(90), after.EndsAt);
    }

    [Fact]
    public async Task AnotherOrganizerAndNormalMembersCannotReschedule()
    {
        var s = Create();
        Assert.Equal("AUCTION_PERMISSION_DENIED", (await Assert.ThrowsAsync<GroupBusinessException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), actor: new(Guid.NewGuid(), false)))).Code);
        Assert.Equal("AUCTION_PERMISSION_DENIED", (await Assert.ThrowsAsync<GroupBusinessException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), actor: s.Member()))).Code);
        Assert.Null(s.State.Auction); Assert.Empty(s.State.ScheduleChanges); Assert.Empty(s.State.Audit);
        Assert.False((await s.Get(s.Member())).CanReschedule);
    }

    [Theory]
    [InlineData(GroupCreatorType.Platform)]
    [InlineData(GroupCreatorType.Organizer)]
    public async Task AdminReschedulesPlatformAndOrganizerGroups(GroupCreatorType creator)
    {
        var s = Create(creator); var admin = Scenario.Admin; var after = await s.Reschedule(Scenario.RuleStart.AddDays(2), actor: admin, reason: AuctionScheduleReason.OperationalIssue, text: "OPS-3821 deployment incident");
        Assert.True(after.WasRescheduled); Assert.Equal("ADMIN", Assert.Single(s.State.ScheduleChanges).ChangedByRole);
        Assert.Single((await s.History(admin)).Items);
        if (creator == GroupCreatorType.Platform) Assert.Equal("AUCTION_PERMISSION_DENIED", (await Assert.ThrowsAsync<GroupBusinessException>(() => s.Reschedule(Scenario.RuleStart.AddDays(3), actor: s.Owner, key: "r2"))).Code);
    }

    [Fact]
    public async Task NewWindowMustBeOrderedInTheFutureAndDifferent()
    {
        var s = Create();
        Assert.Equal("AUCTION_INVALID_TIME_RANGE", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), Scenario.RuleStart.AddDays(1)))).Code);
        Assert.Equal("AUCTION_INVALID_TIME_RANGE", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), Scenario.RuleStart.AddDays(1).AddMinutes(-5)))).Code);
        Assert.Equal("AUCTION_NEW_START_IN_PAST", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(s.Clock.UtcNow.AddMinutes(-1)))).Code);
        Assert.Equal("AUCTION_NEW_START_IN_PAST", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(s.Clock.UtcNow))).Code);
        Assert.Equal("AUCTION_SCHEDULE_UNCHANGED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart, Scenario.RuleStart.AddHours(1)))).Code);
        Assert.Null(s.State.Auction); Assert.Empty(s.State.ScheduleChanges);
    }

    [Fact]
    public async Task ReasonCodeIsRequiredAndOtherNeedsAMeaningfulExplanation()
    {
        var s = Create(); var target = Scenario.RuleStart.AddDays(1);
        Assert.Equal("AUCTION_RESCHEDULE_REASON_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(target, reason: (AuctionScheduleReason)99))).Code);
        foreach (var text in new[] { null, "", "   ", "abc" })
            Assert.Equal("AUCTION_RESCHEDULE_REASON_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(target, reason: AuctionScheduleReason.Other, text: text))).Code);
        Assert.Equal("AUCTION_RESCHEDULE_REASON_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(target, text: new string('x', AuctionScheduleChange.MaxReasonLength + 1)))).Code);
        Assert.Equal("AUCTION_RESCHEDULE_REASON_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(target, message: new string('x', AuctionScheduleChange.MaxMemberMessageLength + 1)))).Code);
        Assert.Empty(s.State.ScheduleChanges); Assert.Null(s.State.Auction);
        var ok = await s.Reschedule(target, reason: AuctionScheduleReason.Other, text: "  Venue unavailable that evening  ", message: "  Moved by a day.  ");
        var change = Assert.Single(s.State.ScheduleChanges); Assert.Equal(("Venue unavailable that evening", "Moved by a day."), (change.ReasonText, change.MemberMessage));
        Assert.Equal((AuctionScheduleReason.Other, "Moved by a day."), (ok.LatestReasonCode, ok.LatestMemberMessage));
    }

    [Fact]
    public async Task MembersSeeReasonCodeAndMemberMessageButNeverInternalNotesOrActors()
    {
        var s = Create(); var admin = Scenario.Admin;
        await s.Reschedule(Scenario.RuleStart.AddDays(1), actor: admin, reason: AuctionScheduleReason.TechnicalIssue, text: "Payment-service deployment incident OPS-3821", message: "The auction has been moved because of a technical issue.");
        var member = await s.Get(s.Member());
        Assert.Equal((AuctionScheduleReason.TechnicalIssue, "The auction has been moved because of a technical issue."), (member.LatestReasonCode, member.LatestMemberMessage));
        var row = Assert.Single((await s.History(s.Member())).Items);
        Assert.Null(row.ReasonText); Assert.Null(row.ChangedByRole); Assert.Null(row.ChangedByName); Assert.Equal(AuctionScheduleReason.TechnicalIssue, row.ReasonCode);
        var operatorRow = Assert.Single((await s.History(admin)).Items);
        Assert.Equal(("Payment-service deployment incident OPS-3821", "ADMIN"), (operatorRow.ReasonText, operatorRow.ChangedByRole));
        var raised = Assert.Single(s.Hook.Raised); Assert.Equal("The auction has been moved because of a technical issue.", raised.MemberMessage);
        Assert.DoesNotContain("OPS-3821", System.Text.Json.JsonSerializer.Serialize(raised));
        // Members cannot open the group-wide history; the owning organizer and admins can.
        Assert.Equal("AUCTION_PERMISSION_DENIED", (await Assert.ThrowsAsync<GroupBusinessException>(() => s.GroupHistory(s.Member()))).Code);
        Assert.Single((await s.GroupHistory()).Items); Assert.Single((await s.GroupHistory(admin)).Items);
    }

    [Fact]
    public async Task OpenAuctionCannotBeRescheduledEvenByAdmin()
    {
        var s = Create(); s.Clock.UtcNow = Scenario.RuleStart; await s.Open(); await s.Bid();
        foreach (var actor in new[] { s.Owner, Scenario.Admin })
            Assert.Equal("AUCTION_ALREADY_OPEN", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), actor: actor))).Code);
        var view = await s.Get(s.Owner); Assert.False(view.CanReschedule); Assert.Contains("already live", view.RescheduleUnavailableReason);
        Assert.Equal(Scenario.RuleStart, s.State.Auction!.StartsAt); Assert.Empty(s.State.ScheduleChanges);
    }

    [Fact]
    public async Task ScheduledAuctionWithBidsIsFlaggedInconsistentNotRescheduled()
    {
        var s = Create(); s.Clock.UtcNow = Scenario.RuleStart; await s.Open(); await s.Bid();
        // Legacy/inconsistent state: bids exist but the status was reverted to SCHEDULED.
        typeof(Auction).GetProperty(nameof(Auction.Status))!.SetValue(s.State.Auction, AuctionStatus.Scheduled);
        s.Clock.UtcNow = Scenario.RuleStart.AddHours(-3);
        Assert.Equal("AUCTION_RESCHEDULE_NOT_ALLOWED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1)))).Code);
        Assert.Contains("needs review", (await s.Get(s.Owner)).RescheduleUnavailableReason);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ClosedAndCompletedAuctionsAreImmutable(bool withBids)
    {
        var s = Create(); s.Clock.UtcNow = Scenario.RuleStart; await s.Open(); if (withBids) await s.Bid(); var closed = await s.Close();
        Assert.Equal(withBids ? "WINNER_SELECTED" : "CLOSED_NO_BIDS", closed.Status);
        Assert.Equal("AUCTION_ALREADY_COMPLETED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), actor: Scenario.Admin))).Code);
        Assert.Equal(Scenario.RuleStart, s.State.Auction!.StartsAt); Assert.Empty(s.State.ScheduleChanges); Assert.False((await s.Get(s.Owner)).CanReschedule);
        // Simulated "Closed" status shares the same gate.
        typeof(Auction).GetProperty(nameof(Auction.Status))!.SetValue(s.State.Auction, AuctionStatus.Closed);
        Assert.Equal("AUCTION_ALREADY_COMPLETED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(1), actor: Scenario.Admin, key: "r2"))).Code);
    }

    [Fact]
    public async Task MultipleReschedulesAppendHistoryAndTheLatestWindowIsAuthoritative()
    {
        var s = Create();
        var first = await s.Reschedule(Scenario.RuleStart.AddDays(1), key: "r1", expected: 0);
        var second = await s.Reschedule(Scenario.RuleStart.AddDays(2), key: "r2", reason: AuctionScheduleReason.TechnicalIssue, actor: Scenario.Admin, expected: first.ScheduleVersion);
        Assert.Equal(2, second.RescheduleCount); Assert.Equal(Scenario.RuleStart.AddDays(2), s.State.Auction!.StartsAt);
        Assert.Equal([1, 2], s.State.ScheduleChanges.Select(c => c.ChangeSequence));
        Assert.Equal(Scenario.RuleStart, s.State.ScheduleChanges[0].PreviousStartsAt); Assert.Equal(Scenario.RuleStart.AddDays(1), s.State.ScheduleChanges[1].PreviousStartsAt);
        Assert.Equal(["ORGANIZER", "ADMIN"], s.State.ScheduleChanges.Select(c => c.ChangedByRole));
        Assert.Equal(Scenario.RuleStart, second.OriginalStartsAt); Assert.Equal(Scenario.RuleStart.AddDays(1), second.PreviousStartsAt); Assert.Equal(AuctionScheduleReason.TechnicalIssue, second.LatestReasonCode);
        Assert.Equal(2, s.State.Audit.Count(a => a.Action == "AUCTION_RESCHEDULED"));
        var page = await s.History(); Assert.Equal(2, page.TotalCount); Assert.Equal([2, 1], page.Items.Select(i => i.ChangeSequence));
    }

    [Fact]
    public async Task StaleScreenGetsAScheduleConflictInsteadOfSilentlyOverwriting()
    {
        var s = Create();
        var organizerView = await s.Get(s.Owner); // organizer opens the dialog (version 0)
        await s.Reschedule(Scenario.RuleStart.AddDays(1), actor: Scenario.Admin, key: "admin-1", expected: 0); // admin changes first
        var stale = await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(Scenario.RuleStart.AddDays(3), key: "org-1", expected: organizerView.ScheduleVersion));
        Assert.Equal("AUCTION_SCHEDULE_CONFLICT", stale.Code);
        Assert.Equal(Scenario.RuleStart.AddDays(1), s.State.Auction!.StartsAt); Assert.Single(s.State.ScheduleChanges);
        var fresh = await s.Get(s.Owner); await s.Reschedule(Scenario.RuleStart.AddDays(3), key: "org-2", expected: fresh.ScheduleVersion);
        Assert.Equal(2, s.State.ScheduleChanges.Count);
    }

    [Fact]
    public async Task IdempotentRetryDoesNotDuplicateHistoryAndDifferentPayloadIsRejected()
    {
        var s = Create(); var target = Scenario.RuleStart.AddDays(1);
        var first = await s.Reschedule(target, key: "same"); var replay = await s.Reschedule(target, key: "same");
        Assert.Single(s.State.ScheduleChanges); Assert.Single(s.State.Audit, a => a.Action == "AUCTION_RESCHEDULED"); Assert.Single(s.Hook.Raised);
        Assert.Equal(first.StartsAt, replay.StartsAt); Assert.Equal(first.RescheduleCount, replay.RescheduleCount);
        Assert.Equal("IDEMPOTENCY_KEY_REUSED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(target.AddHours(1), key: "same"))).Code);
        Assert.Equal("IDEMPOTENCY_KEY_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Reschedule(target.AddHours(2), key: ""))).Code);
    }

    [Fact]
    public async Task MemberReadModelShowsLatestScheduleAndRescheduledFlagButNoHistoryOrActors()
    {
        var s = Create(); var target = Scenario.RuleStart.AddDays(1); await s.Reschedule(target);
        var member = await s.Get(s.Member());
        Assert.Equal(target, member.StartsAt); Assert.True(member.WasRescheduled); Assert.Equal(Scenario.RuleStart, member.OriginalStartsAt);
        Assert.False(member.CanReschedule); Assert.Equal(AuctionScheduleReason.PublicHoliday, member.LatestReasonCode);
        Assert.Single((await s.History(s.Owner)).Items); Assert.Equal(AuctionScheduleReason.PublicHoliday, Assert.Single((await s.History(Scenario.Admin)).Items).ReasonCode);
    }

    [Fact]
    public async Task OldTriggerCannotOpenEarlyAndNewWindowOpensNormallyWithBiddingUnchanged()
    {
        var s = Create(); var target = Scenario.RuleStart.AddDays(1); await s.Reschedule(target);
        // A stale trigger firing at the ORIGINAL start is refused by the authoritative window (defence in depth, no job needed).
        s.Clock.UtcNow = Scenario.RuleStart;
        Assert.Equal("AUCTION_OUTSIDE_WINDOW", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Open())).Code);
        Assert.Equal(AuctionStatus.Scheduled, s.State.Auction!.Status); Assert.False((await s.Get(s.Owner)).CanOpen);
        s.Clock.UtcNow = target; Assert.True((await s.Get(s.Owner)).CanOpen);
        var opened = await s.Open(); Assert.Equal("OPEN", opened.Status); Assert.True(opened.WasRescheduled);
        Assert.Equal(["AUCTION_CREATED", "AUCTION_RESCHEDULED", "AUCTION_OPENED"], s.State.Audit.Select(a => a.Action));
        // Opening twice is refused; bidding and closing behave exactly as before.
        Assert.Equal("AUCTION_ALREADY_EXISTS", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Open())).Code);
        var bid = await s.Bid(150000); Assert.Equal(350000, bid.PotentialWinnerPayout);
        var closed = await s.Close(); Assert.Equal("WINNER_SELECTED", closed.Status); Assert.Equal(350000, closed.Result!.WinnerPayout);
    }

    [Fact]
    public async Task OffsetInputsAreStoredAsTheSameUtcInstant()
    {
        var s = Create();
        var ist = new DateTimeOffset(2030, 1, 3, 19, 0, 0, TimeSpan.FromHours(5.5)); // 7:00 PM IST
        var after = await s.Reschedule(ist, ist.AddHours(1));
        Assert.Equal(new DateTimeOffset(2030, 1, 3, 13, 30, 0, TimeSpan.Zero), after.StartsAt); Assert.Equal(TimeSpan.Zero, s.State.Auction!.StartsAt.Offset);
        Assert.Equal(new TimeOnly(19, 0), TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(after.StartsAt, TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata")).DateTime));
    }

    [Fact]
    public async Task InactiveGroupAndIncompleteContributionsRules()
    {
        var incomplete = Create(complete: false);
        // Moving the date is allowed while contributions are still being collected; opening still is not.
        await incomplete.Reschedule(Scenario.RuleStart.AddDays(1));
        Assert.Equal("CYCLE_NOT_READY_FOR_SELECTION", (await Assert.ThrowsAsync<BusinessRuleException>(() => incomplete.Open())).Code);
        var suspended = Create(); suspended.State.Selection.Group.Stop(false, "review", suspended.Clock.UtcNow);
        Assert.Equal("GROUP_SUSPENDED", (await Assert.ThrowsAsync<BusinessRuleException>(() => suspended.Reschedule(Scenario.RuleStart.AddDays(1)))).Code);
    }

    [Fact]
    public async Task ManyReschedulesPageNewestFirstAndNeverLoadIntoTheAuctionRead()
    {
        // 12 reschedules: the auction read carries only the latest summary; the history endpoint pages 5 at a time.
        var s = Create(); var start = Scenario.RuleStart;
        for (var i = 1; i <= 12; i++) { s.Clock.UtcNow = new DateTimeOffset(2030, 1, 1, 6, i, 0, TimeSpan.Zero); await s.Reschedule(start.AddDays(i), reason: AuctionScheduleReason.OperationalIssue, key: $"k{i}"); }
        var view = await s.Get();
        Assert.Equal(12, view.RescheduleCount); Assert.Equal(start.AddDays(12), view.StartsAt); Assert.Equal(start.AddDays(11), view.PreviousStartsAt); Assert.Equal(start, view.OriginalStartsAt);
        var first = await s.History(page: 1, pageSize: 5); var third = await s.History(page: 3, pageSize: 5);
        Assert.Equal((12, 5, 2), (first.TotalCount, first.Items.Count, third.Items.Count));
        Assert.Equal([12, 11, 10, 9, 8], first.Items.Select(i => i.ChangeSequence)); Assert.Equal([2, 1], third.Items.Select(i => i.ChangeSequence));
        Assert.Equal(start.AddDays(11), first.Items[0].PreviousStartsAt); Assert.Equal(start, third.Items[^1].PreviousStartsAt);
    }
}
