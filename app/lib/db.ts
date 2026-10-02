import * as backendApi from './backendApi';

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

// Note: User mapping is handled by auth-context via SIWS (/api/auth/verify) and /api/user/email

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

export async function getEditions(activeOnly = true) {
  try {
    // If administrative/inactive editions are requested, use the authenticated /mine endpoint
    if (!activeOnly) {
      try {
        const mine = await backendApi.getMyEditions();
        if (mine && Array.isArray(mine)) {
          return mine.map(formatEditionImages);
        }
      } catch (err) {
        console.warn('Could not fetch /api/editions/mine (unauthenticated or error):', err);
        return [];
      }
    }

    const res = await fetch(`${BASE}/api/editions`);
    if (res.ok) {
      const data = await res.json();
      return (data || []).map(formatEditionImages);
    }
  } catch (err) {
    console.error('getEditions Fetch Error:', err);
  }
  return [];
}

function formatEditionImages(ed: any) {
  if (ed && ed.images) {
    ed.images = ed.images.map((img: any) => {
      let finalUrl = img.url;
      if (finalUrl && finalUrl.includes('supabase') && !finalUrl.startsWith('/api/proxy-image')) {
        finalUrl = `/api/proxy-image?url=${encodeURIComponent(finalUrl)}`;
      }
      return {
        ...img,
        url: finalUrl && finalUrl.startsWith('/api/proxy-image') ? `${BASE}${finalUrl}` : finalUrl
      };
    });
  }
  return ed;
}

export async function getEditionById(id: string) {
  try {
    const res = await fetch(`${BASE}/api/editions/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      return formatEditionImages(data);
    }
  } catch (err) {
    console.error('getEditionById Fetch Error:', err);
  }
  return null;
}

export async function saveEdition(editionData: any) {
  try {
    // Separate supported fields for draft creation
    const payload: backendApi.CreateEditionPayload = {
      id: editionData.id,
      brand_id: editionData.brand_id,
      name: editionData.name,
      description: editionData.description,
      price_usd: Number(editionData.price_usd),
      max_supply: Number(editionData.max_supply),
      fabric: editionData.fabric,
      headpiece: editionData.headpiece,
      embroidery: editionData.embroidery,
    };

    const res = await backendApi.createEdition(payload);
    return res;
  } catch (err) {
    console.error('saveEdition API Error:', err);
    throw err;
  }
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

export async function uploadEditionImage(file: File, id: string, tag?: string): Promise<{ url: string; path: string } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64Data = reader.result as string;
        const res = await backendApi.uploadEditionImage(id, base64Data, tag);
        if (res && res.publicUrl) {
          resolve({
            url: res.publicUrl,
            path: res.image.path
          });
        } else {
          resolve(null);
        }
      } catch (err) {
        console.error('uploadEditionImage Fetch Error:', err);
        resolve(null);
      }
    };
    reader.readAsDataURL(file);
  });
}

export async function deleteEditionImage(id: string, path: string): Promise<boolean> {
  try {
    const res = await backendApi.deleteEditionImage(id, path);
    return res && res.success;
  } catch (err) {
    console.error('deleteEditionImage Fetch Error:', err);
    return false;
  }
}
