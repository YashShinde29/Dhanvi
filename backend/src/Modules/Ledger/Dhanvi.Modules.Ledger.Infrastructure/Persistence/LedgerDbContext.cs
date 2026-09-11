using Dhanvi.Modules.Ledger.Domain;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Ledger.Infrastructure.Persistence;

public sealed class LedgerDbContext(DbContextOptions<LedgerDbContext> options) : DbContext(options)
{
    public DbSet<LedgerAccount> Accounts => Set<LedgerAccount>();
    public DbSet<JournalEntry> Journals => Set<JournalEntry>();
    public DbSet<JournalLine> Lines => Set<JournalLine>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var model = modelBuilder;
        model.HasDefaultSchema("ledger"); model.HasSequence<long>("JournalNumberSequence", "ledger");
        var a = model.Entity<LedgerAccount>(); a.ToTable("LedgerAccounts", t => {
            t.HasCheckConstraint("CK_Account_Type", "\"AccountType\" IN ('Asset','Liability','Equity','Revenue','Expense')");
            t.HasCheckConstraint("CK_Account_Normal", "(\"AccountType\" IN ('Asset','Expense') AND \"NormalBalance\" = 'Debit') OR (\"AccountType\" IN ('Liability','Equity','Revenue') AND \"NormalBalance\" = 'Credit')");
        });
        a.HasKey(x => x.Id); a.HasIndex(x => x.Code).IsUnique(); a.Property(x => x.Code).HasMaxLength(20); a.Property(x => x.Name).HasMaxLength(160);
        a.Property(x => x.AccountType).HasConversion<string>(); a.Property(x => x.NormalBalance).HasConversion<string>();
        var j = model.Entity<JournalEntry>(); j.ToTable("JournalEntries", t => {
            t.HasCheckConstraint("CK_Journal_Posted", "\"Status\" = 'POSTED' AND \"LineCount\" >= 2 AND \"DebitTotal\" > 0 AND \"DebitTotal\" = \"CreditTotal\"");
            t.HasCheckConstraint("CK_Journal_Reversal", "(\"EventType\" = 'AccountingReversal' AND \"ReversesJournalEntryId\" IS NOT NULL AND length(trim(\"ReversalReason\")) > 0) OR (\"EventType\" <> 'AccountingReversal' AND \"ReversesJournalEntryId\" IS NULL)");
        });
        j.HasKey(x => x.Id); j.HasIndex(x => x.JournalNumber).IsUnique(); j.HasIndex(x => new { x.EventType, x.EventId }).IsUnique();
        j.HasIndex(x => x.IdempotencyKey).IsUnique(); j.HasIndex(x => x.ReversesJournalEntryId).IsUnique().HasFilter("\"ReversesJournalEntryId\" IS NOT NULL");
        j.HasIndex(x => x.PostedAt); j.HasIndex(x => x.BusinessDate); j.HasIndex(x => x.EventId);
        j.Property(x => x.EventType).HasConversion<string>().HasMaxLength(80); j.Property(x => x.FeePolicy).HasConversion<string>().HasMaxLength(40);
        j.Property(x => x.JournalNumber).HasMaxLength(40); j.Property(x => x.Description).HasMaxLength(1000); j.Property(x => x.ReversalReason).HasMaxLength(1000);
        j.Property(x => x.SourceModule).HasMaxLength(80); j.Property(x => x.SourceFingerprint).HasMaxLength(64); j.Property(x => x.CorrelationId).HasMaxLength(100);
        j.Property(x => x.IdempotencyKey).HasMaxLength(128); j.Property(x => x.BusinessTimeZone).HasMaxLength(100); j.Property(x => x.PolicyVersion).HasMaxLength(40); j.Property(x => x.Status).HasMaxLength(20);
        j.HasOne<JournalEntry>().WithMany().HasForeignKey(x => x.ReversesJournalEntryId).OnDelete(DeleteBehavior.Restrict);
        j.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.JournalEntryId).OnDelete(DeleteBehavior.Restrict); j.Navigation(x => x.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);
        var l = model.Entity<JournalLine>(); l.ToTable("JournalLines", t => {
            t.HasCheckConstraint("CK_Line_Sides", "(\"DebitAmount\" > 0 AND \"CreditAmount\" = 0) OR (\"CreditAmount\" > 0 AND \"DebitAmount\" = 0)");
            t.HasCheckConstraint("CK_Line_Currency", "\"Currency\" = 'INR'");
        });
        l.HasKey(x => x.Id); l.HasOne<LedgerAccount>().WithMany().HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict);
        l.HasIndex(x => x.GroupId); l.HasIndex(x => x.CycleId); l.HasIndex(x => x.MembershipId); l.HasIndex(x => x.SelectionResultId); l.HasIndex(x => x.AuctionResultId);
        l.Property(x => x.Currency).HasMaxLength(3); l.Property(x => x.ReferenceType).HasMaxLength(80); l.Property(x => x.Description).HasMaxLength(500);
        foreach (var entity in new[] { j.Metadata, l.Metadata })
            foreach (var property in entity.GetProperties().Where(p => p.ClrType == typeof(decimal))) { property.SetPrecision(18); property.SetScale(2); }
    }
    private void GuardHistory()
    {
        if (ChangeTracker.Entries().Any(e => e.Entity is JournalEntry or JournalLine && e.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Posted accounting history is immutable. Use a reversal journal.");
    }
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { GuardHistory(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    { GuardHistory(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }
}
