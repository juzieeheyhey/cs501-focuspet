// Models/User.cs
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FocusBackend.Models;

public class Session
{
  [BsonId]
  [BsonRepresentation(BsonType.ObjectId)]
  public string? Id { get; set; }

  public string UserId { get; set; } = string.Empty;
  public DateTime StartTime { get; set; }
  public DateTime EndTime { get; set; }
  public int DurationMinutes { get; set; }
  public Dictionary<string, int> Activity { get; set; } = new Dictionary<string, int>();
  public int FocusScore { get; set; }
}
