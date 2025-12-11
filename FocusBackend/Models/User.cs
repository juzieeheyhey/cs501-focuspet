// Models/User.cs
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FocusBackend.Models;

public class User
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;

    // mapping for initials not stored in the database
    [BsonIgnore]
    public string Initials =>
        $"{(string.IsNullOrEmpty(FirstName) ? "" : FirstName[0])}" +
        $"{(string.IsNullOrEmpty(LastName) ? "" : LastName[0])}".ToUpper();

    public string[] WhiteList { get; set; } = [];
    public string[] BlackList { get; set; } = [];
}
