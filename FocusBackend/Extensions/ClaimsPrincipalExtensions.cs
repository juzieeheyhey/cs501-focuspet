using System.Security.Claims;

namespace FocusBackend.Extensions;

public static class ClaimsPrincipalExtensions
{
    /// <summary>
    /// Get the user id stored in the JWT claims (claim type "userId").
    /// Returns null if not present.
    /// </summary>
    public static string? GetUserId(this ClaimsPrincipal? user) => user?.FindFirst("userId")?.Value;
}
