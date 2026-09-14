namespace Dhanvi.Modules.Groups.Domain;

public sealed record GroupMemberPolicy
{
    public static readonly GroupMemberPolicy Production = new(20, 50);
    public static readonly GroupMemberPolicy Development = new(2, 50);
    public static readonly GroupMemberPolicy Default = Production;

    public int MinimumMembers { get; }
    public int MaximumMembers { get; }

    public GroupMemberPolicy(int minimumMembers, int maximumMembers)
    {
        if (minimumMembers < 2 || maximumMembers != 50 || minimumMembers > maximumMembers)
            throw new ArgumentOutOfRangeException(nameof(minimumMembers), "Group policy must stay within the database safe range of 2–50 members, with maximum 50.");
        MinimumMembers = minimumMembers;
        MaximumMembers = maximumMembers;
    }

    public void ValidateMemberCount(int count) => GroupRules.Require(
        count >= MinimumMembers && count <= MaximumMembers,
        "INVALID_MEMBER_LIMIT", $"Member limit must be between {MinimumMembers} and {MaximumMembers}.");
}
