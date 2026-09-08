using Dhanvi.SharedKernel.Results;

namespace Dhanvi.UnitTests.SharedKernel;

public sealed class ResultTests
{
    [Fact]
    public void SuccessHasNoError()
    {
        var result = Result.Success();

        Assert.True(result.IsSuccess);
        Assert.Equal(ResultError.None, result.Error);
    }
}
