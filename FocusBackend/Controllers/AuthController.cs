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
        // validate required fields
        if (string.IsNullOrWhiteSpace(req.Email) ||
            string.IsNullOrWhiteSpace(req.Password) ||
            string.IsNullOrWhiteSpace(req.ConfirmPassword) ||
            string.IsNullOrWhiteSpace(req.FirstName) ||
            string.IsNullOrWhiteSpace(req.LastName))
        {
            return BadRequest("Please fill in all required fields.");
        }
        // check if passwords match
        if (req.Password != req.ConfirmPassword)
            return BadRequest("Passwords do not match");

        if (await _ctx.Users.Find(u => u.Email == req.Email).AnyAsync())
            return BadRequest("Email already registered");

        var user = new User
        {
            Email = req.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            FirstName = req.FirstName,
            LastName = req.LastName
        };

        await _ctx.Users.InsertOneAsync(user);
        return Ok("Registered successfully");
    }


    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var user = await _ctx.Users.Find(u => u.Email == req.Email).FirstOrDefaultAsync();

        if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized("Invalid credentials");

        var token = GenerateJwt(user);

        return Ok(new 
        { 
            token,
            user = new
            {
                id = user.Id,
                email = user.Email,
                firstName = user.FirstName,
                lastName = user.LastName,
                initials = user.Initials
            }
        });
    }

    private string GenerateJwt(User user)
    {
        // generate JWT token and sign it
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims: new[] { new Claim("userId", user.Id) },
            expires: DateTime.Now.AddDays(7),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
