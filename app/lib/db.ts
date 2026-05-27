import { createClient } from '@supabase/supabase-js';
import { genAddress } from './utils';


// ── Supabase Configuration ───────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

if (typeof window !== 'undefined') {
  if (!supabaseUrl) console.warn('⚠️ Supabase: NEXT_PUBLIC_SUPABASE_URL is missing.');
  if (!supabaseAnonKey) console.warn('⚠️ Supabase: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.');
  if (supabaseAnonKey && !supabaseAnonKey.startsWith('ey')) {
    console.warn('⚠️ Supabase: The Anon Key looks invalid (expected a JWT starting with "ey").');
  }
}

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ── Database Schema (SQL) ────────────────────────────────────────────
/*
  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    private_key TEXT NOT NULL, -- Encrypted in production
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    drop_id TEXT NOT NULL,
    tx_signature TEXT UNIQUE NOT NULL,
    escrow_pda TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, delivered, cancelled
    amount_usd DECIMAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
*/

// ── Admin Authentication ────────────────────────────────────────────

export async function loginAdmin(identifier: string, passwordHash: string) {
  try {
    const res = await fetch('https://circuit-production-9fdc.up.railway.app/api/auth/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, passwordHash })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Admin Auth Error:', data.error);
      return null;
    }
    return data.admin;
  } catch (err) {
    console.error('Admin Auth Fetch Error:', err);
    return null;
  }

  // Fallback: Local simulation for dev
  if (identifier === 'zipp' || identifier === 'marvel' || identifier.includes('@')) {
    return { username: identifier, email: identifier };
  }
  return null;
}

// ── Helper Functions (Simulation Fallback) ───────────────────────────

export async function saveUserMapping(email: string, walletAddress: string, privateKey: string) {
  try {
    const res = await fetch('https://circuit-production-9fdc.up.railway.app/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, wallet_address: walletAddress, private_key: privateKey })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Supabase Mapping Error:', errData.error);
    } else {
      return await res.json();
    }
  } catch (err) {
    console.error('Mapping Fetch Error:', err);
  }

  // Fallback: Local Storage
  const mappings = JSON.parse(localStorage.getItem('circuit_users') || '{}');
  mappings[email] = { walletAddress, privateKey };
  localStorage.setItem('circuit_users', JSON.stringify(mappings));
  return { email, walletAddress };
}

export async function getUserMapping(email: string) {
  try {
    const res = await fetch(`https://circuit-production-9fdc.up.railway.app/api/users/${encodeURIComponent(email)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('getUserMapping Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const mappings = JSON.parse(localStorage.getItem('circuit_users') || '{}');
    return mappings[email] || null;
  }
  return null;
}

// ── Order Management ────────────────────────────────────────────────

export async function saveOrder(orderData: {
  email: string;
  drop_id: string;
  tx_signature: string;
  escrow_pda: string;
  amount_usd: number;
  size?: string;
  quantity?: number;
}) {
  try {
    const res = await fetch('https://circuit-production-9fdc.up.railway.app/api/db/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Supabase Order Error:', errData.error);
    } else {
      return await res.json();
    }
  } catch (err) {
    console.error('saveOrder Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const orders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
    const newOrder = { ...orderData, status: 'pending', created_at: new Date().toISOString() };
    orders.push(newOrder);
    localStorage.setItem('circuit_orders', JSON.stringify(orders));
    return newOrder;
  }
}

export async function updateOrderStatus(txSignature: string, status: 'delivered' | 'cancelled') {
  try {
    const res = await fetch(`https://circuit-production-9fdc.up.railway.app/api/db/orders/${txSignature}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Supabase Update Error:', errData.error);
    } else {
      return await res.json();
    }
  } catch (err) {
    console.error('updateOrderStatus Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const orders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
    const updatedOrders = orders.map((o: any) => 
      o.tx_signature === txSignature ? { ...o, status } : o
    );
    localStorage.setItem('circuit_orders', JSON.stringify(updatedOrders));
  }
}

export async function updateOrderDelivery(email: string, location: string, address: string) {
  try {
    const res = await fetch('https://circuit-production-9fdc.up.railway.app/api/db/orders/delivery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, delivery_location: location, delivery_address: address })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Supabase Update Delivery Error:', errData.error);
    } else {
      return await res.json();
    }
  } catch (err) {
    console.error('updateOrderDelivery Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const orders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
    const updatedOrders = orders.map((o: any) => 
      o.email === email && o.status === 'pending' ? { ...o, delivery_location: location, delivery_address: address } : o
    );
    localStorage.setItem('circuit_orders', JSON.stringify(updatedOrders));
  }
}

export async function getUserOrders(email: string) {
  try {
    const res = await fetch(`https://circuit-production-9fdc.up.railway.app/api/db/orders/${encodeURIComponent(email)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('getUserOrders Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const orders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
    return orders.filter((o: any) => o.email === email);
  }
  return [];
}

// ── Editions / Collections ───────────────────────────────────────────

export async function getEditions(activeOnly = true) {
  if (supabase) {
    let query = supabase.from('editions').select('*');
    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query.order('created_at', { ascending: true });
    
    if (!error) return data || [];
  }
  
  // Fallback default edition
  return [{
    id: 'drop-zero',
    name: '3 Piece Agbada',
    images: [{ url: '/satin.png', tag: 'Front View' }],
    description: 'Fashion sold before it’s made. Circuit reverses the order of production by making manufacturing conditional on confirmed demand.',
    price_usd: 120,
    has_variable_prices: false,
    prices_by_size: { 'Small': 120, 'Medium': 120, 'Large': 120, 'Extra Large': 120 },
    max_supply: 40,
    fabric: 'Duchess satin',
    headpiece: 'Velvet',
    embroidery: 'Metallic thread',
    is_active: true
  }];
}

export async function getEditionById(id: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('editions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    
    if (!error && data) return data;
  }
  
  // Fallback
  if (id === 'drop-zero') {
    return {
      id: 'drop-zero',
      name: '3 Piece Agbada',
      images: [{ url: '/satin.png', tag: 'Front View' }],
      description: 'Fashion sold before it’s made. Circuit reverses the order of production by making manufacturing conditional on confirmed demand.',
      price_usd: 120,
      has_variable_prices: false,
      prices_by_size: { 'Small': 120, 'Medium': 120, 'Large': 120, 'Extra Large': 120 },
      max_supply: 40,
      fabric: 'Duchess satin',
      headpiece: 'Velvet',
      embroidery: 'Metallic thread',
      is_active: true
    };
  }
  return null;
}

export async function saveEdition(editionData: any) {
  if (supabase) {
    // Ensure image_url is still provided to avoid NOT NULL constraint errors
    const payload = {
      ...editionData,
      image_url: editionData.images?.[0]?.url || '/satin.png'
    };
    
    const { data, error } = await supabase
      .from('editions')
      .upsert(payload, { onConflict: 'id' })
      .select();
    
    if (error) console.error('Supabase Save Edition Error:', JSON.stringify(error, null, 2), error.message, error.details);
    return data;
  }
  return null;
}

// ── Complete Order Lifecycle Management ──────────────────────────────

export async function updateOrderStatusLifecycle(
  orderId: string,
  status: string,
  garmentSerial?: string
) {
  try {
    const res = await fetch('https://circuit-production-9fdc.up.railway.app/api/db/orders/lifecycle', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status, garmentSerial })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Supabase Update Lifecycle Error:', errData.error);
    } else {
      return await res.json();
    }
  } catch (err) {
    console.error('updateOrderStatusLifecycle Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const orders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
    const updatedOrders = orders.map((o: any) => {
      if (o.id === orderId) {
        const updated = { ...o, status };
        if (garmentSerial) updated.garment_serial = garmentSerial;
        if (['produced', 'shipped', 'delivered'].includes(status) && !o.mint_address) {
          updated.mint_address = genAddress();
        }
        return updated;
      }
      return o;
    });
    localStorage.setItem('circuit_orders', JSON.stringify(updatedOrders));
  }
}

export async function updateOrderShipmentDetails(orderId: string, details: string) {
  try {
    const res = await fetch('https://circuit-production-9fdc.up.railway.app/api/db/orders/shipment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, details })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Supabase Update Shipment Details Error:', errData.error);
    } else {
      return await res.json();
    }
  } catch (err) {
    console.error('updateOrderShipmentDetails Fetch Error:', err);
  }

  // Fallback: Local Storage
  if (typeof window !== 'undefined') {
    const orders = JSON.parse(localStorage.getItem('circuit_orders') || '[]');
    const updatedOrders = orders.map((o: any) => 
      o.id === orderId ? { ...o, shipment_details: details } : o
    );
    localStorage.setItem('circuit_orders', JSON.stringify(updatedOrders));
  }
}

export async function uploadEditionImage(file: File, id: string): Promise<string | null> {
  if (!supabase) {
    // Local Simulation: Convert file to Base64 data URL for local storage persistence
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.readAsDataURL(file);
    });
  }

  try {
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `${id}-${Date.now()}.${fileExt}`;
    const filePath = `collections/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('collection-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage
      .from('collection-images')
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (err) {
    console.error('Error uploading image to Supabase:', err);
    return null;
  }
}

export async function deleteEditionImage(imageUrl: string): Promise<boolean> {
  if (!supabase) {
    return true; // Simulate success
  }

  // Check if it's a Supabase URL
  if (!imageUrl.includes('supabase.co') && !imageUrl.includes('supabase.in')) {
    return true; // Ignore placeholder or base64
  }

  try {
    // Extract file path from public URL
    // Public URL format: https://[project-id].supabase.co/storage/v1/object/public/collection-images/collections/[filename]
    const parts = imageUrl.split('/collection-images/');
    if (parts.length < 2) return false;
    const filePath = decodeURIComponent(parts[1]);

    const { error } = await supabase.storage
      .from('collection-images')
      .remove([filePath]);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Error deleting image from Supabase:', err);
    return false;
  }
}


