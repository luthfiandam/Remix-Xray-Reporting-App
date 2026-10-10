import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Penggunaan: npx tsx scripts/provisionSupabaseUsers.ts [--help]');
  console.log('\nDeskripsi:');
  console.log('  Membuat user dan profile otentikasi awal di Supabase Auth & PostgreSQL.');
  console.log('\nOptions:');
  console.log('  --help, -h                      - Menampilkan panduan bantuan ini');
  console.log('\nEnvironment variables yang dibutuhkan:');
  console.log('  VITE_SUPABASE_URL               - URL Project Supabase');
  console.log('  SUPABASE_SERVICE_ROLE_KEY       - Supabase Service Role Secret Key');
  console.log('  PROVISION_SUPERVISOR_PASSWORD   - Password akun supervisor');
  console.log('  PROVISION_TECHNICIAN_PASSWORD   - Password akun teknisi');
  process.exit(0);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SECRET_KEY || '';
const supervisorPassword = process.env.PROVISION_SUPERVISOR_PASSWORD || '';
const technicianPassword = process.env.PROVISION_TECHNICIAN_PASSWORD || '';

async function provision() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Error: VITE_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diset di environment variables.');
    process.exit(1);
  }

  if (!supervisorPassword || !technicianPassword) {
    console.error('❌ Error: PROVISION_SUPERVISOR_PASSWORD dan PROVISION_TECHNICIAN_PASSWORD wajib diset di environment variables.');
    console.error('   Jalankan dengan: PROVISION_SUPERVISOR_PASSWORD="<password>" PROVISION_TECHNICIAN_PASSWORD="<password>" npx tsx scripts/provisionSupabaseUsers.ts');
    process.exit(1);
  }

  console.log('🚀 Starting Supabase User & Profile Provisioning...');
  console.log('URL:', SUPABASE_URL);

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const usersToProvision = [
    {
      email: 'supervisor@faskampen.id',
      password: supervisorPassword,
      display_name: 'Supervisor Faskampen',
      role: 'supervisor' as const,
      technician_id: null,
      active: true,
      account_type: 'supervisor' as const,
    },
    {
      email: 'luthfi@faskampen.id',
      password: technicianPassword,
      display_name: 'Luthfi Ramadhan',
      role: 'technician' as const,
      technician_id: 1,
      active: true,
      account_type: 'technician' as const,
    },
    {
      email: 'zaky@faskampen.id',
      password: technicianPassword,
      display_name: 'Zaky Mubarok',
      role: 'technician' as const,
      technician_id: 2,
      active: true,
      account_type: 'technician' as const,
    },
  ];

  for (const u of usersToProvision) {
    console.log(`\nProcessing user: ${u.email} (${u.role})...`);
    
    // 1. Check if user already exists
    const { data: existingData } = await supabaseAdmin.auth.admin.listUsers();
    const usersList: any[] = (existingData as any)?.users || [];
    let user = usersList.find((item: any) => item.email === u.email);

    if (!user) {
      console.log(`Creating auth user: ${u.email}...`);
      const { data: newUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: {
          display_name: u.display_name,
          role: u.role,
          technician_id: u.technician_id,
        },
      });

      if (createError || !newUserData.user) {
        console.error(`❌ Failed to create user ${u.email}:`, createError?.message);
        continue;
      }
      user = newUserData.user;
      console.log(`✅ Auth user created with ID: ${user.id}`);
    } else {
      console.log(`ℹ️ Auth user already exists with ID: ${user.id}`);
    }

    // 2. Upsert profile in `profiles` table
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
      {
        id: user.id,
        email: u.email,
        display_name: u.display_name,
        technician_id: u.technician_id,
        role: u.role,
        active: u.active,
        account_type: u.account_type,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      console.error(`❌ Failed to upsert profile for ${u.email}:`, profileError.message);
    } else {
      console.log(`✅ Profile upserted successfully for ${u.display_name}`);
    }
  }

  console.log('\n🎉 Supabase Provisioning Complete!');
}

provision().catch((err) => {
  console.error('Fatal provisioning error:', err);
});
