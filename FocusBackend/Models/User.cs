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
    public string[] WhiteList { get; set; } = [];
    public string[] BlackList { get; set; } = [];
}
