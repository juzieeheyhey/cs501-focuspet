using System.Reflection.Metadata;
using MongoDB.Driver;
using FocusBackend.Models;

namespace FocusBackend.Data;

public class MongoContext
{
  private readonly IMongoDatabase _database;  // MongoDB database instance

  // Constructor to initialize MongoDB connection
  public MongoContext(IConfiguration config)
  {
    var client = new MongoClient(config["Mongo:ConnectionString"]);
    _database = client.GetDatabase(config["Mongo:DatabaseName"]!);
  }

  // Collections
  public IMongoCollection<User> Users => _database.GetCollection<User>("Users");
  public IMongoCollection<Session> Sessions => _database.GetCollection<Session>("Sessions");
}