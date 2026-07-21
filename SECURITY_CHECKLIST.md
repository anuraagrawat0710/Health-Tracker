# Website Security Checklist
## Vercel + Supabase Deployment Security Guide

---

## 1. Environment Variables & Secrets 🔑

**Objective**: Protect sensitive credentials from being exposed in frontend code

### Actions:
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` in Vercel (public, safe for frontend)
- [ ] Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel (public, limited permissions)
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel as secret (backend only)
- [ ] Never commit `.env` files with secrets to git
- [ ] Add `.env.local` to `.gitignore`
- [ ] Verify no secrets appear in frontend bundles (build audit)

**Key Points**:
- ❌ NEVER expose service role key in frontend
- ✅ Only public keys accessible to browser
- ✅ All sensitive keys in Vercel project settings

---

## 2. Enable Row Level Security (RLS) 🔒

**Objective**: Ensure database rows are only accessible to authorized users

### Actions:
- [ ] Go to Supabase Dashboard → Authentication → Policies
- [ ] Enable RLS on **ALL tables**
- [ ] Create SELECT policy for user profiles (users can read own profile)
  ```sql
  CREATE POLICY "Users can read own profile"
    ON profiles
    FOR SELECT
    USING (auth.uid() = id);
  ```
- [ ] Create INSERT policy (users can only insert their own data)
  ```sql
  CREATE POLICY "Users can insert own profile"
    ON profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);
  ```
- [ ] Create UPDATE policy (users can only update their own data)
  ```sql
  CREATE POLICY "Users can update own profile"
    ON profiles
    FOR UPDATE
    USING (auth.uid() = id);
  ```
- [ ] Create DELETE policy if needed
- [ ] Test policies by querying as different users

**Key Points**:
- RLS is mandatory for frontend access
- Always use `auth.uid()` for user-specific policies
- Test with multiple user accounts

---

## 3. Secure API Routes 🛡️

**Objective**: Hide sensitive operations behind server-side functions

### Actions:
- [ ] Create `/api/` routes for all sensitive operations
- [ ] Move admin operations to serverless functions
- [ ] Use `SUPABASE_SERVICE_ROLE_KEY` only in API routes
- [ ] Verify JWT tokens in every protected route
- [ ] Example: Payment processing, data deletion, admin tasks

**Example Implementation**:
```javascript
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify JWT token
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  // Initialize admin client
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Perform sensitive operation
  // ...
}
```

**Key Points**:
- All financial/admin operations must use admin client
- Always validate authentication before processing
- Use try-catch for error handling

---

## 4. Authentication & Authorization 👤

**Objective**: Ensure only authenticated users access sensitive data

### Actions:
- [ ] Use Supabase Auth for user management
- [ ] Require authentication for all sensitive operations
- [ ] Validate user session before showing/editing data
- [ ] Implement role-based access control (if needed)
- [ ] Set appropriate JWT expiration times
- [ ] Configure password requirements in Supabase
- [ ] Enable email verification for new accounts

**Key Points**:
- Never trust client-side authentication checks
- Always validate on server/database
- Use secure password hashing (Supabase handles this)

---

## 5. Input Validation & Sanitization ✔️

**Objective**: Prevent injection attacks and malicious input

### Actions:
- [ ] Validate all user inputs on frontend
- [ ] Validate all user inputs on backend (mandatory)
- [ ] Use Supabase client library for safe queries
- [ ] Never construct SQL queries with string concatenation
- [ ] Sanitize HTML inputs if displaying user content
- [ ] Use prepared statements/parameterized queries

**Example**:
```javascript
// ❌ WRONG - SQL Injection vulnerability
const query = `SELECT * FROM users WHERE email = '${userInput}'`;

// ✅ CORRECT - Safe with Supabase client
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('email', userInput);
```

---

## 6. HTTPS & Encryption 🔐

**Objective**: Ensure all data in transit is encrypted

### Actions:
- [ ] Verify HTTPS is enforced on Vercel (automatic)
- [ ] Disable HTTP access entirely
- [ ] Ensure all Supabase communication uses HTTPS
- [ ] Add HTTPS-only header to Vercel config
- [ ] Test with mixed content warnings in browser

**Vercel Configuration**:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=31536000; includeSubDomains"
        }
      ]
    }
  ]
}
```

---

## 7. Rate Limiting & Abuse Prevention 🚦

**Objective**: Prevent brute force attacks and excessive requests

### Actions:
- [ ] Implement rate limiting on login endpoint
- [ ] Limit API endpoint requests per IP/user
- [ ] Add CAPTCHA to sensitive forms (optional)
- [ ] Monitor failed login attempts
- [ ] Lock accounts after multiple failed attempts
- [ ] Set up alerts for unusual activity

**Implementation Options**:
- Vercel middleware for rate limiting
- Supabase Edge Functions
- Third-party services (e.g., Clerk, Auth0)

---

## 8. Security Headers 📋

**Objective**: Add HTTP security headers to prevent common attacks

### Actions:
- [ ] Add X-Content-Type-Options: nosniff
- [ ] Add X-Frame-Options: DENY
- [ ] Add X-XSS-Protection: 1; mode=block
- [ ] Add Referrer-Policy: strict-origin-when-cross-origin
- [ ] Add Content-Security-Policy (CSP)
- [ ] Test headers with browser DevTools

**Vercel Configuration**:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

---

## 9. Logging & Monitoring 📊

**Objective**: Track and detect suspicious activity

### Actions:
- [ ] Enable Supabase audit logs
- [ ] Monitor Vercel deployment logs
- [ ] Set up error tracking (e.g., Sentry)
- [ ] Monitor failed authentication attempts
- [ ] Track API usage and anomalies
- [ ] Set up alerts for critical errors
- [ ] Review logs regularly (weekly/monthly)

**Key Events to Monitor**:
- Failed login attempts
- Unauthorized access attempts
- Unusual data access patterns
- Error spikes
- Deployment changes

---

## 10. Dependency Management 📦

**Objective**: Keep all libraries and frameworks up-to-date

### Actions:
- [ ] Run `npm audit` regularly
- [ ] Update Next.js to latest version
- [ ] Update Supabase client library
- [ ] Update all security-related packages
- [ ] Check for deprecations in dependencies
- [ ] Set up dependabot for automatic updates
- [ ] Review and test updates before deploying

**Commands**:
```bash
npm audit                 # Check for vulnerabilities
npm outdated             # See outdated packages
npm update               # Update packages
npm audit fix            # Auto-fix vulnerabilities
```

---

## 11. Database Backups & Recovery 💾

**Objective**: Ensure data can be recovered in case of incidents

### Actions:
- [ ] Enable automated backups in Supabase
- [ ] Set backup frequency (daily recommended)
- [ ] Test backup restoration process
- [ ] Store backups in secure location
- [ ] Document disaster recovery procedure
- [ ] Monitor backup completion

---

## 12. CORS Configuration 🌐

**Objective**: Control which domains can access your API

### Actions:
- [ ] Configure CORS in Supabase for frontend domain
- [ ] Set allowed origins to specific domain(s)
- [ ] Deny requests from unknown origins
- [ ] Test CORS with browser DevTools Network tab

**Supabase Configuration**:
- Set allowed origins to `https://yourdomain.com`
- Do NOT use wildcard `*` in production

---

## 13. Third-Party Integrations 🔗

**Objective**: Securely handle external services and APIs

### Actions:
- [ ] Review permissions for any OAuth integrations
- [ ] Store API keys securely in Vercel
- [ ] Use OAuth 2.0 for third-party auth
- [ ] Limit scope of permissions requested
- [ ] Regularly audit connected services
- [ ] Revoke unused integrations

---

## 14. Testing & Audits 🧪

**Objective**: Verify security measures are working

### Actions:
- [ ] Perform security testing before launch
- [ ] Test SQL injection vulnerabilities
- [ ] Test XSS (Cross-Site Scripting) attack vectors
- [ ] Test CSRF (Cross-Site Request Forgery) protection
- [ ] Use tools: OWASP ZAP, Burp Suite (free tier)
- [ ] Conduct regular penetration testing
- [ ] Test with different user roles/permissions

---

## 15. Regular Security Review ✅

**Objective**: Maintain security posture over time

### Weekly:
- [ ] Review recent deployments
- [ ] Check error logs for anomalies
- [ ] Monitor authentication metrics

### Monthly:
- [ ] Review audit logs
- [ ] Check dependency updates
- [ ] Verify backup status
- [ ] Review access logs

### Quarterly:
- [ ] Full security audit
- [ ] Penetration testing
- [ ] Update security policies
- [ ] Review and update this checklist

---

## Quick Start Summary

1. ✅ Set up environment variables in Vercel
2. ✅ Enable RLS on all Supabase tables
3. ✅ Create secure API routes for sensitive operations
4. ✅ Implement user authentication
5. ✅ Add security headers
6. ✅ Set up monitoring and logging
7. ✅ Keep dependencies updated
8. ✅ Test security regularly

---

## Resources

- **Supabase Security**: https://supabase.com/docs/guides/auth
- **Vercel Security**: https://vercel.com/docs/concepts/functions/serverless-functions
- **OWASP Top 10**: https://owasp.org/www-project-top-ten/
- **Supabase RLS**: https://supabase.com/docs/guides/auth/row-level-security

---

## Notes

- Last Updated: 2026-07-21
- Health Tracker Project
- Document Version: 1.0

**Remember**: Security is an ongoing process, not a one-time task. Review and update regularly!