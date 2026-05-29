const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

// ── Admin Authentication ────────────────────────────────────────────

export async function loginAdmin(identifier: string, passwordHash: string) {
  try {
    const res = await fetch(`${BASE}/api/auth/admin`, {
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
}

// ── Helper Functions ─────────────────────────────────────────────────

export async function saveUserMapping(email: string, walletAddress: string, privateKey: string) {
  try {
    const res = await fetch(`${BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, wallet_address: walletAddress, private_key: privateKey })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Save user mapping error:', errData.error);
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
    const res = await fetch(`${BASE}/api/users/${encodeURIComponent(email)}`);
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
    const res = await fetch(`${BASE}/api/db/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Save order error:', errData.error);
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
    const res = await fetch(`${BASE}/api/db/orders/${txSignature}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Update order status error:', errData.error);
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
    const res = await fetch(`${BASE}/api/db/orders/delivery`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, delivery_location: location, delivery_address: address })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Update delivery error:', errData.error);
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
      o.email === email && o.status === 'pending'
        ? { ...o, delivery_location: location, delivery_address: address }
        : o
    );
    localStorage.setItem('circuit_orders', JSON.stringify(updatedOrders));
  }
}

export async function getUserOrders(email: string) {
  try {
    const res = await fetch(`${BASE}/api/db/orders/${encodeURIComponent(email)}`);
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
// Supabase storage removed — editions use static fallback until backend
// endpoints for edition management are added.

export async function getEditions(_activeOnly = true) {
  return [{
    id: 'drop-zero',
    name: '3 Piece Agbada',
    images: [{ url: '/satin.png', tag: 'Front View' }],
    description: "Fashion sold before it's made. Circuit reverses the order of production by making manufacturing conditional on confirmed demand.",
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
  if (id === 'drop-zero' || id) {
    return {
      id: id || 'drop-zero',
      name: '3 Piece Agbada',
      images: [{ url: '/satin.png', tag: 'Front View' }],
      description: "Fashion sold before it's made. Circuit reverses the order of production by making manufacturing conditional on confirmed demand.",
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

export async function saveEdition(_editionData: any) {
  return null;
}

// ── Complete Order Lifecycle Management ──────────────────────────────

export async function updateOrderStatusLifecycle(
  orderId: string,
  status: string,
  garmentSerial?: string
) {
  try {
    const res = await fetch(`${BASE}/api/db/orders/lifecycle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status, garmentSerial })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Update lifecycle error:', errData.error);
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
        return updated;
      }
      return o;
    });
    localStorage.setItem('circuit_orders', JSON.stringify(updatedOrders));
  }
}

export async function updateOrderShipmentDetails(orderId: string, details: string) {
  try {
    const res = await fetch(`${BASE}/api/db/orders/shipment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, details })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error('Update shipment details error:', errData.error);
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

export async function uploadEditionImage(file: File, _id: string): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export async function deleteEditionImage(_imageUrl: string): Promise<boolean> {
  return true;
}
