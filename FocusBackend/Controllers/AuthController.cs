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

namespace FocusBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly MongoContext _ctx;
    private readonly IConfiguration _config;

    public AuthController(MongoContext ctx, IConfiguration config)
    {
        _ctx = ctx;
        _config = config;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        if (await _ctx.Users.Find(u => u.Email == req.Email).AnyAsync())
            return BadRequest("Email already registered");

        var user = new User
        {
            Email = req.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password)
        };

        await _ctx.Users.InsertOneAsync(user);
        return Ok("Registered successfully");
    }


    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] User creds)
    {
        var user = await _ctx.Users.Find(u => u.Email == creds.Email).FirstOrDefaultAsync();
        if (user == null || !BCrypt.Net.BCrypt.Verify(creds.PasswordHash, user.PasswordHash))
            return Unauthorized("Invalid credentials");

        var token = GenerateJwt(user);
        return Ok(new { token });
    }

    private string GenerateJwt(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims: new[] { new Claim(ClaimTypes.Name, user.Id) },
            expires: DateTime.Now.AddDays(7),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
