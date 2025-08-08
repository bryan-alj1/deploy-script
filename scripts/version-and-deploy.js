const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const envFilePath = path.resolve(__dirname, '../src/environment/environment.ts');
// const environmentProd = path.resolve(__dirname, '../.env.production');

function checkForPendingChanges() {
  try {
    // Check for uncommitted changes
    const status = execSync('git status --porcelain').toString().trim();
    if (status) {
      console.error('Error: There are uncommitted changes in the current branch.');
      console.error('Please commit or stash your changes before running this script.');
      process.exit(1);
    }

    // Check for untracked files
    const untrackedFiles = execSync('git ls-files --others --exclude-standard').toString().trim();
    if (untrackedFiles) {
      console.error('Error: There are untracked files in the current branch.');
      console.error('Please add or ignore these files before running this script.');
      process.exit(1);
    }

    console.log('No pending changes detected. Proceeding with version update...');
    return true;
  } catch (error) {
    console.error('Error checking for pending changes:', error.message);
    process.exit(1);
  }
}

function getCurrentVersion() {
  const envFileContent = fs.readFileSync(envFilePath, 'utf8');
  const versionMatch = envFileContent.match(/version:\s*['"]([^'"]+)['"]/);

  if (!versionMatch) {
    console.error('Could not find version in environment.ts');
    process.exit(1);
  }

  return versionMatch[1];
}

function getApiUrlProdEnvironment() {
  const envFileContent = fs.readFileSync(environmentProd, 'utf8');
  const envMatch = envFileContent.match(/^API_URL=(.+)$/m);
  if (!envMatch) {
    console.error('Could not find API_URL in .env.production');
    process.exit(1);
  }
  return envMatch[1];
}

function incrementMinorVersion(version) {
  const [major, minor,] = version.split('.');
  const newMinor = parseInt(minor, 10) + 1;
  return `${major}.${newMinor}.0`;
}

function incrementPatchVersion(version) {
  const [major, minor, patch] = version.split('.');
  const newPatch = parseInt(patch, 10) + 1;
  return `${major}.${minor}.${newPatch}`;
}

function updateVersion(newVersion) {
  let envFileContent = fs.readFileSync(envFilePath, 'utf8');
  envFileContent = envFileContent.replace(
    /(version:\s*['"])([^'"]+)(['"])/,
    `$1${newVersion}$3`
  );

  fs.writeFileSync(envFilePath, envFileContent, 'utf8');
  console.log(`Version updated to ${newVersion}`);
}

function gitOperations(newVersion) {
  try {
    // Get current branch name
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    console.log(`Working on current branch: ${currentBranch}`);

    // Add and commit the version update
    execSync('git add src/environment/environment.ts', { stdio: 'inherit' });
    execSync(`git commit -m "Project version updated to ${newVersion}"`, { stdio: 'inherit' });
    console.log(`Changes committed with message: "Project version updated to ${newVersion}"`);

    // Create tag with the new version
    execSync(`git tag ${newVersion}`, { stdio: 'inherit' });
    console.log(`Tag created: ${newVersion}`);

    // Push the tag and current branch to origin
    execSync(`git push origin ${newVersion}`, { stdio: 'inherit' });
    execSync(`git push origin ${currentBranch}`, { stdio: 'inherit' });
    console.log(`Tag ${newVersion} and branch ${currentBranch} pushed to origin`);

    return currentBranch;
  } catch (error) {
    console.error('Git operations failed:', error.message);
    process.exit(1);
  }
}

function makeApiRequest(apiUrl, { version }) {
  try {
    const curlCommand = `curl -X POST "${apiUrl}/version/update" -H "Content-Type: application/json" -d '${JSON.stringify({ version })}'`;
    execSync(curlCommand, { stdio: 'inherit' });
    console.log(`API request to api/version/update with ${JSON.stringify({ version })} completed successfully`);
  } catch (error) {
    console.error('API request failed:', error.message);
  }
}

function createGitHubRelease(version) {
  try {
    execSync(`gh release create ${version} --title "Versión ${version}"`, { stdio: 'inherit' });
    console.log(`GitHub release created: Versión ${version}`);
    return true;
  } catch (error) {
    console.error('GitHub release creation failed:', error.message);
    return false;
  }
}

async function main() {
  try {
    // Process command line arguments
    const isDryRun = process.argv.includes('--dry-run');
    const isMinor = process.argv.includes('--minor');
    const isPatch = process.argv.includes('--patch');

    if (!isMinor && !isPatch) {
      console.error('Error: You must specify either --minor or --patch to indicate the type of version increment');
      process.exit(1);
    }

    if (isMinor && isPatch) {
      console.error('Error: You cannot specify both --minor and --patch at the same time');
      process.exit(1);
    }

    // Check for pending changes before proceeding
    checkForPendingChanges();

    // Get current and new version
    const currentVersion = getCurrentVersion();
    console.log(`Current version: ${currentVersion}`);

    let newVersion;
    if (isMinor) newVersion = incrementMinorVersion(currentVersion);
    if (isPatch) newVersion = incrementPatchVersion(currentVersion);

    console.log(`New version: ${newVersion}`);

    // const API_URL = getApiUrlProdEnvironment();

    if (isDryRun) {
      console.log('DRY RUN MODE: Would update version to', newVersion);
      console.log('DRY RUN MODE: Would update environment.ts');
      console.log('DRY RUN MODE: Would commit changes with message "Project version updated to ' + newVersion + '"');
      console.log('DRY RUN MODE: Would create tag ' + newVersion);
      console.log('DRY RUN MODE: Would push current branch and tag to origin');
      console.log('DRY RUN MODE: Would run deploy:prod');
      console.log('DRY RUN MODE: Would create GitHub release "Versión ' + newVersion + '"');
      console.log('DRY RUN MODE: Would make API request to', `${API_URL}/version/update with`, { version: newVersion });
      return;
    }

    const originalState = {
      version: currentVersion
    };

    try {
      // Update version in environment.ts
      updateVersion(newVersion);

      // Commit changes, create tag, and push
      gitOperations(newVersion);

      // Deploy to production
      console.log('Running deploy:prod...');
      // execSync('yarn run deploy:prod', { stdio: 'inherit' });
      console.log('Deployment completed successfully');

      // Create GitHub release
      createGitHubRelease(newVersion);

      // Update version in Firebase via API
      // makeApiRequest(API_URL, { version: newVersion });

      console.log('Version update and deployment process completed successfully');
    } catch (error) {
      console.error('Error during execution:', error.message);
      console.error('Attempting to restore original state...');

      try {
        // Restore original version if needed
        updateVersion(originalState.version);
        console.error('Original state restored. Please check the repository status manually.');
      } catch (restoreError) {
        console.error('Failed to restore original state:', restoreError.message);
        console.error('Manual intervention required to restore repository state.');
      }

      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
