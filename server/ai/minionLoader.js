// Project imports
var BotPlayer = require('./minionPlayer');
var FakeSocket = require('./minionSocket');
var PacketHandler = require('../PacketHandler');

function MinionLoader(gameServer) {
    this.gameServer = gameServer;
    this.loadNames();
}

module.exports = MinionLoader;

MinionLoader.prototype.getName = function() {
    return this.gameServer.minionname;
};

MinionLoader.prototype.loadNames = function() {
    this.randomNames = [];

    // Load names
    try {
        var fs = require("fs");
        this.randomNames = fs.readFileSync("./botnames.txt", "utf8").split(/[\r\n]+/).filter(function(x) {
            return x != ''; // filter empty names
        });
    } catch (e) {
        // Nothing, use the default names
    }

    this.nameIndex = 0;
};

MinionLoader.prototype.addBot = function(owner, name) {
    var fakeSocket = new FakeSocket(this.gameServer);
    fakeSocket.playerTracker = new BotPlayer(this.gameServer, fakeSocket, owner);
    fakeSocket.packetHandler = new PacketHandler(this.gameServer, fakeSocket);

    // Add to client list
    this.gameServer.clients.push(fakeSocket);
    if (!name || typeof name == "undefined") name = "minion";
    // Add to world
    fakeSocket.packetHandler.setNickname(name);
};
