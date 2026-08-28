// 为两个赛事各添加2个项目，达到每赛事8个项目（共16个）
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envPath = new URL('../.env', import.meta.url);
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^VITE_SUPABASE_(URL|ANON_KEY)\s*=\s*(.+)/);
  if (match) env[match[1]] = match[2].trim();
});

const supabase = createClient(env.URL, env.ANON_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data: comps } = await supabase.from('competitions').select('*').limit(2);
  console.log('Found competitions:', comps?.length || 0);

  for (const comp of comps) {
    const { data: events } = await supabase.from('events').select('*').eq('competition_id', comp.id);
    console.log(`[${comp.name}] has ${events.length} events`);

    if (events.length < 8) {
      const newEvents = [
        {
          competition_id: comp.id,
          name: '个人绳舞',
          code: 'RW',
          category: 'performance',
          description: '个人绳舞表演',
          max_athletes: 1,
          is_individual: true,
          order_index: events.length,
        },
        {
          competition_id: comp.id,
          name: '双人同步跳绳',
          code: 'DS',
          category: 'speed',
          description: '双人同步速度跳绳',
          max_athletes: 2,
          is_individual: false,
          order_index: events.length + 1,
        },
      ];

      for (const ev of newEvents) {
        const { data: newEv, error } = await supabase.from('events').insert(ev).select().single();
        if (error) {
          console.error('Failed to create event:', error.message);
          continue;
        }
        console.log(`  Created event: ${newEv.name} (id: ${newEv.id})`);

        // Create groups for this event
        const genders = newEv.is_individual ? ['male', 'female'] : ['mixed'];
        for (const gender of genders) {
          const ages = newEv.is_individual
            ? [{ min: 7, max: 9, label: 'U9' }, { min: 10, max: 12, label: 'U13' }]
            : [{ min: 7, max: 12, label: 'U13' }];
          for (const age of ages) {
            await supabase.from('event_groups').insert({
              event_id: newEv.id,
              name: `${gender === 'male' ? 'M' : gender === 'female' ? 'F' : 'MX'}-${age.label}`,
              type: 'age',
              gender,
              age_min: age.min,
              age_max: age.max,
              max_registrations: 200,
              current_count: 0,
              order_index: 0,
            });
          }
        }
        console.log(`    Groups created for ${newEv.name}`);
      }
    }
  }
  console.log('Done!');
}

main().catch(console.error);
