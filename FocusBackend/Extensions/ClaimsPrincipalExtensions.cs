using System.Security.Claims;

namespace FocusBackend.Extensions;

public static class ClaimsPrincipalExtensions
{
    // Get the user id stored in the JWT claims (claim type "userId")
    public static string? GetUserId(this ClaimsPrincipal? user) => user?.FindFirst("userId")?.Value;
}
