import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';

async function deployRules() {
  const sa = JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf-8'));
  const rulesContent = fs.readFileSync('firestore.rules', 'utf-8');

  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  console.log("1. Creating new ruleset with latest firestore.rules...");
  const createRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}/rulesets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: {
        files: [
          {
            name: 'firestore.rules',
            content: rulesContent
          }
        ]
      }
    })
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    console.error("Ruleset creation failed:", createData);
    process.exit(1);
  }

  console.log("Created ruleset:", createData.name);

  console.log("2. Releasing ruleset to cloud.firestore...");
  const releaseRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}/releases/cloud.firestore`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      release: {
        name: `projects/${sa.project_id}/releases/cloud.firestore`,
        rulesetName: createData.name
      }
    })
  });

  const releaseData = await releaseRes.json();
  if (!releaseRes.ok) {
    console.error("Release failed:", releaseData);
    process.exit(1);
  }

  console.log("✅ Successfully deployed latest firestore.rules to live Cloud Firestore!");
  console.log("Release details:", releaseData);
}

deployRules().catch(console.error);
