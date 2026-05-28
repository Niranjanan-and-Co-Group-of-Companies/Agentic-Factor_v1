import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/services/notifications';

// ============================================================
// Admin Auth Service — Email + Password + OTP (SMTP2GO)
// Completely separate from Supabase user auth.
// ============================================================

const OTP_EXPIRY_MINUTES = 5;
const SALT_ROUNDS = 12;

/**
 * Ensure the primary admin exists in the database.
 * Called on first /admin access.
 */
export async function ensurePrimaryAdmin(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', adminEmail)
    .single();

  if (!existing) {
    // Create primary admin with a random password (they'll set it via OTP flow)
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await supabase.from('admin_users').insert({
      email: adminEmail,
      password_hash: hash,
      is_primary: true,
    });

    console.log(`[Admin] Primary admin created: ${adminEmail}`);
    // Send the temp password via email
    await sendEmail({
      to: adminEmail,
      subject: '🔐 Agentic Factor Admin — Initial Password',
      body: `Your admin panel is ready.\n\nEmail: ${adminEmail}\nTemporary Password: ${tempPassword}\n\nYou'll also need an OTP to login. Change your password after first login.\n\nhttps://agenticfactor.io/admin/login`,
    }).catch(() => console.log('[Admin] Could not send initial password email'));
  }
}

/**
 * Verify admin email + password. If valid, send OTP.
 * Returns true if credentials are valid (OTP has been sent).
 */
export async function verifyCredentialsAndSendOTP(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, email, password_hash')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!admin) {
    return { success: false, error: 'Invalid credentials' };
  }

  const passwordValid = await bcrypt.compare(password, admin.password_hash);
  if (!passwordValid) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  // Store OTP in DB
  await supabase
    .from('admin_users')
    .update({ otp_code: otp, otp_expires_at: expiresAt })
    .eq('id', admin.id);

  // Send OTP via SMTP2GO
  await sendEmail({
    to: admin.email,
    subject: '🔑 Agentic Factor Admin OTP',
    body: `Your one-time password for admin login:\n\n${otp}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, ignore this email.`,
  });

  return { success: true };
}

/**
 * Verify OTP and complete login.
 * Returns a session token (random hex) on success.
 */
export async function verifyOTP(email: string, otp: string): Promise<{ success: boolean; token?: string; error?: string }> {
  const supabase = createServiceClient();

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, otp_code, otp_expires_at')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!admin) {
    return { success: false, error: 'Invalid credentials' };
  }

  if (!admin.otp_code || admin.otp_code !== otp) {
    return { success: false, error: 'Invalid OTP' };
  }

  if (admin.otp_expires_at && new Date(admin.otp_expires_at) < new Date()) {
    return { success: false, error: 'OTP expired. Please login again.' };
  }

  // Clear OTP and update last login
  await supabase
    .from('admin_users')
    .update({ otp_code: null, otp_expires_at: null, last_login: new Date().toISOString() })
    .eq('id', admin.id);

  // Generate session token
  const token = crypto.randomBytes(32).toString('hex');

  return { success: true, token };
}

/**
 * Add a new admin user.
 */
export async function addAdmin(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (existing) {
    return { success: false, error: 'Admin with this email already exists' };
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  await supabase.from('admin_users').insert({
    email: email.toLowerCase().trim(),
    password_hash: hash,
    is_primary: false,
  });

  // Notify the new admin
  await sendEmail({
    to: email,
    subject: '🎉 Agentic Factor Admin Access Granted',
    body: `You've been added as an admin.\n\nEmail: ${email}\nPassword: ${password}\n\nLogin at: https://agenticfactor.io/admin/login\n\nYou'll receive an OTP via email each time you login.`,
  }).catch(() => {});

  return { success: true };
}

/**
 * Remove an admin user.
 */
export async function removeAdmin(adminId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  // Prevent deleting primary admin
  const { data: admin } = await supabase
    .from('admin_users')
    .select('is_primary')
    .eq('id', adminId)
    .single();

  if (admin?.is_primary) {
    return { success: false, error: 'Cannot remove the primary admin' };
  }

  await supabase.from('admin_users').delete().eq('id', adminId);
  return { success: true };
}

/**
 * List all admin users (for the admin panel).
 */
export async function listAdmins(): Promise<any[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('admin_users')
    .select('id, email, is_primary, created_at, last_login')
    .order('created_at', { ascending: true });
  return data || [];
}

/**
 * Change admin password by ID.
 */
export async function changePassword(adminId: string, newPassword: string): Promise<void> {
  const supabase = createServiceClient();
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await supabase
    .from('admin_users')
    .update({ password_hash: hash })
    .eq('id', adminId);
}

/**
 * Verify admin password without sending OTP (for password reset flow).
 */
export async function verifyAdmin(email: string, password: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, password_hash')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!admin) return false;
  return bcrypt.compare(password, admin.password_hash);
}

/**
 * Update admin password by email.
 */
export async function updateAdminPassword(email: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  const { error } = await supabase
    .from('admin_users')
    .update({ password_hash: hash })
    .eq('email', email.toLowerCase().trim());

  if (error) return { success: false, error: error.message };
  return { success: true };
}
