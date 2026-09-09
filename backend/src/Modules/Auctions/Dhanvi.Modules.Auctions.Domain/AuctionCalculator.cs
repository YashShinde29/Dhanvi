using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Auctions.Domain;

public sealed record AuctionCalculation(decimal WinnerPayout, decimal GrossMemberShare, decimal PlatformFee,
    decimal MemberBenefitPool, decimal BenefitPerNonWinner, int NonWinnerCount);
public static class AuctionCalculator
{
    public const string Version = "DHANVI_AUCTION_V1";
    public static AuctionCalculation Calculate(decimal groupValue, int memberLimit, decimal discount, AuctionFeePolicy policy)
    {
        GroupRules.Contribution(groupValue, memberLimit);
        BusinessRuleException.Require(policy == AuctionFeePolicy.WinnerMemberShare, "UNSUPPORTED_AUCTION_FEE_POLICY", "This fee policy is not implemented.");
        BusinessRuleException.Require(discount > 0 && discount < groupValue && decimal.Round(discount, 2) == discount, "INVALID_DISCOUNT", "Discount must be positive, below the group value, and exact to two decimal places.");
        BusinessRuleException.Require(discount * 100 % memberLimit == 0, "INVALID_AUCTION_ALLOCATION_PRECISION", "Discount divided by all member positions must be exact to two decimal places.");
        var share = discount / memberLimit;
        return new(groupValue - discount, share, share, discount - share, share, memberLimit - 1);
    }
}
