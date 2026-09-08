namespace Dhanvi.SharedKernel.Exceptions;

public abstract class DhanviException(string message, Exception? innerException = null) : Exception(message, innerException);

