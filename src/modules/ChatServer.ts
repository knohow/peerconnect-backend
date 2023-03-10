/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
// #!/usr/bin/env node

// Code stolen from: https://github.com/mdn/samples-server/blob/master/s/webrtc-from-chat/chatserver.js

"use strict";
import * as websocket from 'websocket';
let WebSocketServer = websocket.server;


// Used for managing the text chat user list.

let connectionArray = [];
let nextID = Date.now();
let appendToMakeUnique = 1;

function log(text) {
  let time = new Date();

  console.log(`[` + time.toLocaleTimeString() + `] ` + text);
}


// If you want to implement support for blocking specific origins, this is
// where you do it. Just return false to refuse WebSocket connections given
// the specified origin.
function originIsAllowed() {
  return true;    // We will accept all connections
}

// Scans the list of users and see if the specified name is unique. If it is,
// return true. Otherwise, returns false. We want all users to have unique
// names.
function isUsernameUnique(name) {
  let isUnique = true;
  let i;

  for (i=0; i<connectionArray.length; i++) {
    if (connectionArray[i].username === name) {
      isUnique = false;
      break;
    }
  }
  return isUnique;
}

// Sends a message (which is already stringified JSON) to a single
// user, given their username. We use this for the WebRTC signaling,
// and we could use it for private text messaging.
function sendToOneUser(target, msgString) {
  let i;

  for (i=0; i<connectionArray.length; i++) {
    if (connectionArray[i].username === target) {
      connectionArray[i].sendUTF(msgString);
      break;
    }
  }
}

// Scan the list of connections and return the one for the specified
// clientID. Each login gets an ID that doesn't change during the session,
// so it can be tracked across username changes.
function getConnectionForID(id) {
  let connect = null;
  let i;

  for (i=0; i<connectionArray.length; i++) {
    if (connectionArray[i].clientID === id) {
      connect = connectionArray[i];
      break;
    }
  }

  return connect;
}

// Builds a message object of type "userlist" which contains the names of
// all connected users. Used to ramp up newly logged-in users and,
// inefficiently, to handle name change notifications.
function makeUserListMessage() {
  let userListMsg = {
    type: `userlist`,
    users: []
  };
  let i;

  // Add the users to the list

  for (i=0; i<connectionArray.length; i++) {
    userListMsg.users.push(connectionArray[i].username);
  }

  return userListMsg;
}

// Sends a "userlist" message to all chat members. This is a cheesy way
// to ensure that every join/drop is reflected everywhere. It would be more
// efficient to send simple join/drop messages to each user, but this is
// good enough for this simple example.
function sendUserListToAll() {
  let userListMsg = makeUserListMessage();
  let userListMsgStr = JSON.stringify(userListMsg);
  let i;

  for (i=0; i<connectionArray.length; i++) {
    connectionArray[i].sendUTF(userListMsgStr);
  }
}

// Create the WebSocket server by converting the HTTPS server into one.
export function startWebsocketServer(httpServer: any) {
  let wsServer = new WebSocketServer({
    httpServer,
    autoAcceptConnections: false
  });

  if (!wsServer) {
    log(`ERROR: Unable to create WebSocket server!`);
  }

  // Set up a "connect" message handler on our WebSocket server. This is
  // called whenever a user connects to the server's port using the
  // WebSocket protocol.

  wsServer.on(`request`, (request) => {
    if (!originIsAllowed()) {
      request.reject();
      log(`Connection from ` + request.origin + ` rejected.`);
      return;
    }

    // Accept the request and get a connection.

    let connection = request.accept(`json`, request.origin);

    // Add the new connection to our list of connections.

    log(`Connection accepted from ` + connection.remoteAddress + `.`);
    connectionArray.push(connection);

    connection.clientID = nextID;
    nextID++;

    // Send the new client its token; it send back a "username" message to
    // tell us what username they want to use.

    let msg = {
      type: `id`,
      id: connection.clientID
    };

    connection.sendUTF(JSON.stringify(msg));

    // Set up a handler for the "message" event received over WebSocket. This
    // is a message sent by a client, and may be text to share with other
    // users, a private message (text or signaling) for one user, or a command
    // to the server.

    connection.on(`message`, (message) => {
      if (message.type === `utf8`) {
        log(`Received Message: ` + message.utf8Data);

        // Process incoming data.

        let sendToClients = true;
        msg = JSON.parse(message.utf8Data);
        let connect = getConnectionForID(msg.id);

        // Take a look at the incoming object and act on it based
        // on its type. Unknown message types are passed through,
        // since they may be used to implement client-side features.
        // Messages with a "target" property are sent only to a user
        // by that name.

        switch(msg.type) {
          // Public, textual message
          case `message`:
            (<any> msg).name = connect.username;
            (<any> msg).text = (<any> msg).text.replace(/(<([^>]+)>)/ig, ``);
            break;

          // Username change
          case `username`:
            let nameChanged = false;
            let origName = (<any> msg).name;

            // Ensure the name is unique by appending a number to it
            // if it's not; keep trying that until it works.
            while (!isUsernameUnique((<any> msg).name)) {
              (<any> msg).name = origName + appendToMakeUnique;
              appendToMakeUnique++;
              nameChanged = true;
            }

            // If the name had to be changed, we send a "rejectusername"
            // message back to the user so they know their name has been
            // altered by the server.
            if (nameChanged) {
              let changeMsg = {
                id: msg.id,
                type: `rejectusername`,
                name: (<any> msg).name
              };
              connect.sendUTF(JSON.stringify(changeMsg));
            }

            // Set this connection's final username and send out the
            // updated user list to all users. Yeah, we're sending a full
            // list instead of just updating. It's horribly inefficient
            // but this is a demo. Don't do this in a real app.
            connect.username = (<any> msg).name;
            sendUserListToAll();
            sendToClients = false;  // We already sent the proper responses
            break;
        }

        // Convert the revised message back to JSON and send it out
        // to the specified client or all clients, as appropriate. We
        // pass through any messages not specifically handled
        // in the select block above. This allows the clients to
        // exchange signaling and other control objects unimpeded.

        if (sendToClients) {
          let msgString = JSON.stringify(msg);
          let i;

          // If the message specifies a target username, only send the
          // message to them. Otherwise, send it to every user.
          if ((<any> msg).target && (<any> msg).target !== undefined && (<any> msg).target.length !== 0) {
            sendToOneUser((<any> msg).target, msgString);
          } else {
            for (i=0; i<connectionArray.length; i++) {
              connectionArray[i].sendUTF(msgString);
            }
          }
        }
      }
    });

    // Handle the WebSocket "close" event; this means a user has logged off
    // or has been disconnected.
    connection.on(`close`, (reason, description) => {
      // First, remove the connection from the list of connections.
      connectionArray = connectionArray.filter((el) => {
        return el.connected;
      });

      // Now send the updated user list. Again, please don't do this in a
      // real application. Your users won't like you very much.
      sendUserListToAll();

      // Build and output log output for close information.

      let logMessage = `Connection closed: ` + connection.remoteAddress + ` (` +
                      reason;
      if (description !== null && description.length !== 0) {
        logMessage += `: ` + description;
      }
      logMessage += `)`;
      log(logMessage);
    });
  });
}