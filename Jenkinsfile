// MyTrack — build the Docker image, test it, ship it to the server over SSH
// and start it there with docker compose (rolls back if it isn't healthy).
//
// Jenkins setup (once):
//   • Plugins: Pipeline, Git, Credentials Binding, SSH Agent.
//   • The Jenkins agent needs Docker (it builds the image).
//   • Credentials:
//       mytrack-deploy-ssh  "SSH Username with private key" for the server
//       mytrack-env         "Secret file": the production .env (see .env.example)
//   • The server needs Docker + the compose plugin, and the SSH user must be
//     allowed to run docker (member of the "docker" group).
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 45, unit: 'MINUTES')
  }

  parameters {
    string(name: 'DEPLOY_HOST', defaultValue: 'your.server.ip', description: 'Server to deploy to (hostname or IP)')
    string(name: 'DEPLOY_USER', defaultValue: 'deploy', description: 'SSH user on the server')
    string(name: 'DEPLOY_DIR', defaultValue: '/opt/mytrack', description: 'Folder on the server for docker-compose.yml and .env')
    string(name: 'SSH_PORT', defaultValue: '22', description: 'SSH port on the server')
    booleanParam(name: 'RUN_MIGRATIONS', defaultValue: false, description: 'Apply scripts/schema.sql before starting (MariaDB only — the schema uses MariaDB syntax)')
    booleanParam(name: 'DEPLOY', defaultValue: true, description: 'Untick to only build and test the image')
  }

  environment {
    IMAGE = 'mytrack'
    SSH_CRED = 'mytrack-deploy-ssh'
    ENV_CRED = 'mytrack-env'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.TAG = "${env.BUILD_NUMBER}-${env.GIT_SHORT}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} ${env.GIT_SHORT}"
        }
      }
    }

    stage('Build image') {
      steps {
        sh 'docker build --pull -t "$IMAGE:$TAG" .'
      }
    }

    stage('Smoke test') {
      // Starts the image without a database and checks the public pages load.
      steps {
        sh '''
          set -e
          NAME="mytrack-ci-$BUILD_NUMBER"
          docker rm -f "$NAME" >/dev/null 2>&1 || true
          docker run -d --name "$NAME" -e JWT_SECRET=ci-smoke-test "$IMAGE:$TAG"
          trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
          for path in /login /manifest.webmanifest /pdfjs/pdf.min.mjs /tesseract/worker.min.js; do
            ok=""
            for i in $(seq 1 30); do
              if docker exec "$NAME" node -e "fetch('http://127.0.0.1:3000$path').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ok=1; break; fi
              sleep 1
            done
            [ -n "$ok" ] || { echo "Smoke test failed: $path"; docker logs "$NAME"; exit 1; }
            echo "OK $path"
          done
        '''
      }
    }

    stage('Ship image') {
      when { expression { params.DEPLOY } }
      steps {
        sshagent(credentials: [env.SSH_CRED]) {
          sh '''
            set -e
            SSH="ssh -o StrictHostKeyChecking=accept-new -p $SSH_PORT $DEPLOY_USER@$DEPLOY_HOST"
            $SSH "mkdir -p '$DEPLOY_DIR'"
            # No registry needed: stream the image straight into the server's Docker.
            docker save "$IMAGE:$TAG" | gzip | $SSH 'gunzip | docker load'
          '''
        }
      }
    }

    stage('Deploy') {
      when { expression { params.DEPLOY } }
      steps {
        withCredentials([file(credentialsId: env.ENV_CRED, variable: 'ENV_FILE')]) {
          sshagent(credentials: [env.SSH_CRED]) {
            sh '''
              set -e
              SSH="ssh -o StrictHostKeyChecking=accept-new -p $SSH_PORT $DEPLOY_USER@$DEPLOY_HOST"
              SCP="scp -o StrictHostKeyChecking=accept-new -P $SSH_PORT"
              $SCP docker-compose.yml deploy/remote-deploy.sh "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR/"
              $SCP "$ENV_FILE" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR/.env"
              $SSH "chmod 600 '$DEPLOY_DIR/.env' && chmod +x '$DEPLOY_DIR/remote-deploy.sh' && '$DEPLOY_DIR/remote-deploy.sh' '$TAG' '$RUN_MIGRATIONS'"
            '''
          }
        }
      }
    }
  }

  post {
    always {
      // Free disk on the Jenkins agent; the server keeps its own copies.
      sh 'docker rmi "$IMAGE:$TAG" >/dev/null 2>&1 || true; docker image prune -f >/dev/null 2>&1 || true'
    }
    success {
      echo "Deployed ${env.IMAGE}:${env.TAG}" + (params.DEPLOY ? " to ${params.DEPLOY_HOST}" : ' (build only)')
    }
  }
}
