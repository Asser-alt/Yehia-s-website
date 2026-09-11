# Yes for English — Shared Server Version

## Important
GitHub Pages cannot run `server.js`. Use GitHub as the code repository and Render as the Node.js server.

## Deploy
1. Create a GitHub repository.
2. Upload all files in this folder.
3. On Render, create a new Web Service and connect the GitHub repository.
4. Render will use `render.yaml`, or set:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Open the Render URL on both phones. They will use the same server state.

## What was added
- Shared users/packages/lessons/access codes state through the server.
- Shared learning progress through `/api/progress/:username`.
- Automatic progress synchronization.
- Automatic polling every few seconds so changes made on one device can appear on another.

## Note
This is suitable for a school/project prototype. It is not production-secure: passwords are stored in the JSON state file and the state API has no authentication. Also, Render's normal filesystem is not guaranteed to be permanent, so a real production version should use a database and persistent file storage.
