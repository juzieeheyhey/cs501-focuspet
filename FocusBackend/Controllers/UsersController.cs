using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using FocusBackend.Data;
using FocusBackend.Models;
using FocusBackend.Extensions;

namespace FocusBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly MongoContext _ctx;

    public UsersController(MongoContext ctx)
    {
        _ctx = ctx;
    }

    public class UpdateListsRequest
    {
        public string[]? WhiteList { get; set; }
        public string[]? BlackList { get; set; }
    }

    [HttpGet("lists")]
    [Authorize]         // Require authentication
    public async Task<IActionResult> GetLists()
    {
        // Get the user ID from the JWT token claims
        var userId = User.GetUserId();
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        // find corresponding user
        var user = await _ctx.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
        if (user == null) return NotFound();

        // return user's white and black lists
        return Ok(new { user.WhiteList, user.BlackList });
    }

    // PUT: api/users/lists
    [HttpPut("lists")]
    [Authorize]
    public async Task<IActionResult> UpdateLists([FromBody] UpdateListsRequest req)
    {
        var userId = User.GetUserId();
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var updateDef = new List<UpdateDefinition<User>>();
        var builder = Builders<User>.Update;

        // only update lists if provided
        if (req.WhiteList != null)
            updateDef.Add(builder.Set(u => u.WhiteList, req.WhiteList));
        if (req.BlackList != null)
            updateDef.Add(builder.Set(u => u.BlackList, req.BlackList));

        if (!updateDef.Any()) return BadRequest("No lists provided");       // nothing to update

        // combine all updates into a single update definition
        var combined = builder.Combine(updateDef);
        var result = await _ctx.Users.UpdateOneAsync(u => u.Id == userId, combined);

        if (result.MatchedCount == 0) return NotFound();

        return Ok("Lists updated");
    }
}
