const path = require('path')

const scriptsDir = path.resolve(__dirname, 'scripts')

module.exports = {
  apps: [
    {
      name: 'hub',
      script: path.join(scriptsDir, 'start-hub.sh'),
      cwd: scriptsDir,
      interpreter: 'bash',
      autorestart: true,
      env: {
        HUB_PROJECT: process.env.HUB_PROJECT || ''
      }
    },
    {
      name: 'dmx',
      script: path.join(scriptsDir, 'start-dmx.sh'),
      cwd: scriptsDir,
      interpreter: 'bash',
      autorestart: true
    },
    {
      name: 'midi',
      script: path.join(scriptsDir, 'start-midi.sh'),
      cwd: scriptsDir,
      interpreter: 'bash',
      autorestart: true
    },
    {
      name: 'musicanalyser',
      script: path.join(scriptsDir, 'start-musicanalyser.sh'),
      cwd: scriptsDir,
      interpreter: 'bash',
      autorestart: true
    },
    {
      name: 'deliver',
      script: path.join(scriptsDir, 'start-deliver.sh'),
      cwd: scriptsDir,
      interpreter: 'bash',
      autorestart: true
    },
    {
      name: 'neewer',
      script: path.join(scriptsDir, 'start-neewer.sh'),
      cwd: scriptsDir,
      interpreter: 'bash',
      autorestart: true
    }
  ]
}
