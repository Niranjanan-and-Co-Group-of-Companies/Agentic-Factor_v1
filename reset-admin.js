require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const email = 'niranjanant7@gmail.com';
  const password = 'agenticfactor';
  const hash = await bcrypt.hash(password, 12);
  
  const { data, error } = await supabase
    .from('admin_users')
    .upsert({
      email: email,
      password_hash: hash,
      is_primary: true
    }, { onConflict: 'email' });
    
  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Password reset successfully for ${email}. New password: ${password}`);
  }
}
run();
