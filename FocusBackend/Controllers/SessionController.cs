// Controllers/AuthController.cs
using Microsoft.AspNetCore.Mvc;
using FocusBackend.Data;
using FocusBackend.Models;
using FocusBackend.Models.Requests;
using MongoDB.Driver;
using BCrypt.Net;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace FocusBackend.Controllers
{
  [ApiController]
  [Route("api/[controller]")]
  public class SessionController : ControllerBase
  {
    private readonly MongoContext _ctx;
    private readonly IConfiguration _config;

    public SessionController(MongoContext ctx, IConfiguration config)
    {
      _ctx = ctx;
      _config = config;
    }

    // DTO for creating a session. Adjust properties to match your Session entity.
    public class CreateSessionDto
    {
      public DateTime StartTime { get; set; }

      public DateTime EndTime { get; set; }
      public int DurationSession { get; set; }
      public string UserId { get; set; } = string.Empty;

      public Dictionary<string, int> Activity { get; set; } = new Dictionary<string, int>();
      public int FocusScore { get; set; }
    }

    // POST: api/session
    [HttpPost]
    public async Task<IActionResult> CreateSession([FromBody] CreateSessionDto dto)
    {
      if (dto == null) return BadRequest();

      var session = new Session
      {
        UserId = dto.UserId,
        StartTime = dto.StartTime,
        EndTime = dto.EndTime,
        DurationSession = dto.DurationSession,
        Activity = dto.Activity,
        FocusScore = dto.FocusScore,
      };

      await _ctx.Sessions.InsertOneAsync(session);

      // Return 201 with route to fetch created session. Make sure GetSession exists (below).
      return CreatedAtAction(nameof(GetSession), new { id = session.Id.ToString() }, session);
    }

    // GET: api/session/{id}
    [HttpGet("{id}")]
    public async Task<IActionResult> GetSession(string id)
    {
      // Ensure the incoming string id can be converted to a MongoDB ObjectId.
      if (!MongoDB.Bson.ObjectId.TryParse(id, out var objectId))
      {
        return BadRequest("Invalid id format");
      }

      var filter = Builders<Session>.Filter.Eq("_id", objectId);
      var session = await _ctx.Sessions.Find(filter).FirstOrDefaultAsync();
      if (session == null) return NotFound();
      return Ok(session);
    }

    // GET: api/session/user/{userId}
    [HttpGet("user/{userId}")]
    public async Task<IActionResult> GetSessionsByUser(string userId)
    {
      // Ensure incoming string id can be converted to a MongoDB ObjectId.
      if (!MongoDB.Bson.ObjectId.TryParse(userId, out var objectId))
      {
        return BadRequest("Invalid userId format");
      }

      var filter = Builders<Session>.Filter.Eq("UserId", userId);
      var sessions = await _ctx.Sessions.Find(filter).ToListAsync();
      return Ok(sessions);
    }
  }
  
}