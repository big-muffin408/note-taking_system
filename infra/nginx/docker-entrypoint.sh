#!/bin/sh
set -e

# Substitute environment variables in nginx config
envsubst '${AI_SERVICE_SECRET}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Start nginx
exec nginx -g 'daemon off;'
