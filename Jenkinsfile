// MyTrack — build the Docker image, test it, ship it to the server over SSH
// and start it there with docker compose (rolls back if it isn't healthy).
//
// Jenkins setup (once):
//   • Plugins: Pipeline, Git, Credentials Binding, GitHub (for the push trigger).
//   • The Jenkins agent needs Docker (it builds the image) and sshpass.
//   • Credentials:
//       gsm-school-ssh  "Username with password" for the server (same server as gsm-samiti)
//       mytrack-env     "Secret file": the production .env (see .env.example)
//   • The server needs Docker + the compose plugin, Nginx and certbot. The SSH
//     user must be able to run docker and write to /etc/nginx (root, as for gsm-samiti).
//   • DNS: an A record for DOMAIN pointing at DEPLOY_HOST before the first deploy,
//     otherwise certbot can't issue the certificate.
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 45, unit: 'MINUTES')
  }

  triggers {
    // Build automatically on GitHub push (needs the GitHub webhook) with polling as a fallback
    githubPush()
    pollSCM('H/5 * * * *')
  }

  parameters {
    string(name: 'DEPLOY_HOST', defaultValue: '187.126.117.103', description: 'Server to deploy to (hostname or IP)')
    string(name: 'DEPLOY_DIR', defaultValue: '/var/www/mytrack', description: 'Folder on the server for docker-compose.yml and .env')
    string(name: 'SSH_PORT', defaultValue: '22', description: 'SSH port on the server')
    string(name: 'DOMAIN', defaultValue: 'my-track.glamofashion.com', description: 'Public domain (Nginx site + Let\'s Encrypt certificate)')
    string(name: 'APP_PORT', defaultValue: '3006', description: 'Port on the server\'s localhost the container listens on (must be free: gsm-samiti uses 3005)')
    booleanParam(name: 'RUN_MIGRATIONS', defaultValue: false, description: 'Apply scripts/schema.sql before starting (MariaDB only — the schema uses MariaDB syntax)')
    booleanParam(name: 'DEPLOY', defaultValue: true, description: 'Untick to only build and test the image')
  }

  environment {
    APP_NAME = 'mytrack'
    IMAGE = 'mytrack'
    SSH_CRED = 'gsm-school-ssh'
    ENV_CRED = 'mytrack-env'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git log -1 --pretty=format:"%h - %an: %s"'
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
      when { allOf { expression { params.DEPLOY }; anyOf { branch 'main'; expression { env.BRANCH_NAME == null } } } }
      steps {
        withCredentials([usernamePassword(credentialsId: env.SSH_CRED, usernameVariable: 'SSH_USER', passwordVariable: 'SSHPASS')]) {
          // sshpass -e reads the password from $SSHPASS, so it never shows up in logs or `ps`
          sh '''
            set -e
            SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -p $SSH_PORT $SSH_USER@$DEPLOY_HOST"
            $SSH "mkdir -p '$DEPLOY_DIR'"
            # No registry needed: stream the image straight into the server's Docker.
            docker save "$IMAGE:$TAG" | gzip | $SSH 'gunzip | docker load'
          '''
        }
      }
    }

    stage('Deploy') {
      when { allOf { expression { params.DEPLOY }; anyOf { branch 'main'; expression { env.BRANCH_NAME == null } } } }
      steps {
        withCredentials([usernamePassword(credentialsId: env.SSH_CRED, usernameVariable: 'SSH_USER', passwordVariable: 'SSHPASS'),
                         file(credentialsId: env.ENV_CRED, variable: 'ENV_FILE')]) {
          sh '''
            set -e
            SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30"
            SSH="sshpass -e ssh $SSH_OPTS -p $SSH_PORT $SSH_USER@$DEPLOY_HOST"
            SCP="sshpass -e scp $SSH_OPTS -P $SSH_PORT"
            $SCP docker-compose.yml deploy/remote-deploy.sh deploy/nginx/mytrack.conf "$SSH_USER@$DEPLOY_HOST:$DEPLOY_DIR/"
            $SCP "$ENV_FILE" "$SSH_USER@$DEPLOY_HOST:$DEPLOY_DIR/.env"

            # HOST_PORT is read by docker-compose.yml; set here so it overrides any value in .env
            $SSH "chmod 600 '$DEPLOY_DIR/.env' && chmod +x '$DEPLOY_DIR/remote-deploy.sh' && HOST_PORT='$APP_PORT' '$DEPLOY_DIR/remote-deploy.sh' '$TAG' '$RUN_MIGRATIONS'"

            $SSH bash -se <<EOF
              set -e
              # First deploy only: Nginx site for the domain, then a Let's Encrypt certificate
              if [ ! -f /etc/nginx/sites-available/$DOMAIN ]; then
                sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$APP_PORT/g" \
                    "$DEPLOY_DIR/mytrack.conf" > /etc/nginx/sites-available/$DOMAIN
                ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
                nginx -t
                systemctl reload nginx
              fi
              if [ ! -d /etc/letsencrypt/live/$DOMAIN ]; then
                certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
                    --register-unsafely-without-email --redirect
              fi
EOF
          '''
        }
      }
    }

    stage('Health Check') {
      when { allOf { expression { params.DEPLOY }; anyOf { branch 'main'; expression { env.BRANCH_NAME == null } } } }
      steps {
        sh '''
          for i in $(seq 1 12); do
            if curl -fsS -o /dev/null "https://$DOMAIN/login"; then
              echo "https://$DOMAIN is up"
              exit 0
            fi
            echo "Waiting for app... ($i/12)"
            sleep 5
          done
          echo "https://$DOMAIN did not respond"
          exit 1
        '''
      }
    }
  }

  post {
    always {
      // Free disk on the Jenkins agent; the server keeps its own copies.
      sh 'docker rmi "$IMAGE:$TAG" >/dev/null 2>&1 || true; docker image prune -f >/dev/null 2>&1 || true'
    }
    success {
      echo "Build #${env.BUILD_NUMBER}: ${env.IMAGE}:${env.TAG}" + (params.DEPLOY ? " deployed to https://${params.DOMAIN}" : ' (build only)')
    }
    failure {
      echo "Build #${env.BUILD_NUMBER} failed — remote-deploy.sh rolls back to the previous version if the new one isn't healthy."
    }
  }
}
