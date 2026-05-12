#!/bin/bash

# Security configuration check script
# This script checks if the production environment is properly configured

set -e

echo "🔒 Checking security configuration..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found"
    echo "   Please copy .env.production to .env and configure it"
    exit 1
fi

# Source .env file
source .env

# Function to check if a variable is set and not a placeholder
check_var() {
    local var_name=$1
    local var_value=$2
    local is_required=$3

    if [ -z "$var_value" ]; then
        if [ "$is_required" = "true" ]; then
            echo "❌ $var_name is not set"
            return 1
        else
            echo "⚠️  $var_name is not set (optional)"
            return 0
        fi
    fi

    # Check for placeholder values
    if [[ "$var_value" == *"CHANGE_ME"* ]] || [[ "$var_value" == *"change-in-production"* ]]; then
        echo "❌ $var_name contains placeholder value"
        return 1
    fi

    echo "✅ $var_name is configured"
    return 0
}

# Check critical security variables
errors=0

echo "Checking critical security variables..."
check_var "JWT_SECRET" "$JWT_SECRET" "true" || ((errors++))
check_var "INTERNAL_SERVICE_SECRET" "$INTERNAL_SERVICE_SECRET" "true" || ((errors++))
check_var "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD" "true" || ((errors++))
check_var "MYSQL_PASSWORD" "$MYSQL_PASSWORD" "true" || ((errors++))
check_var "MONGO_INITDB_ROOT_PASSWORD" "$MONGO_INITDB_ROOT_PASSWORD" "true" || ((errors++))
check_var "MINIO_ROOT_USER" "$MINIO_ROOT_USER" "true" || ((errors++))
check_var "MINIO_ROOT_PASSWORD" "$MINIO_ROOT_PASSWORD" "true" || ((errors++))

echo ""
echo "Checking application configuration..."
check_var "ALLOWED_ORIGINS" "$ALLOWED_ORIGINS" "true" || ((errors++))
check_var "APP_BASE_URL" "$APP_BASE_URL" "true" || ((errors++))
check_var "SERVER_PUBLIC_URL" "$SERVER_PUBLIC_URL" "true" || ((errors++))

echo ""
echo "Checking optional configuration..."
check_var "GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID" "false"
check_var "GOOGLE_CLIENT_SECRET" "$GOOGLE_CLIENT_SECRET" "false"
check_var "SMTP_HOST" "$SMTP_HOST" "false"
check_var "SMTP_USER" "$SMTP_USER" "false"
check_var "SMTP_PASS" "$SMTP_PASS" "false"

echo ""
if [ $errors -gt 0 ]; then
    echo "❌ Found $errors security issues"
    echo "   Please fix the issues above before deploying to production"
    exit 1
else
    echo "✅ All security checks passed"
    echo "   Your configuration looks good for production deployment"
fi
