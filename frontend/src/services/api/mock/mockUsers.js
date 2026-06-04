// Mock user data store.

export const MOCK_USERS = [
  { id: 'user_riya',   name: 'Riya Sharma',    email: 'riya.sharma@bluetokai.com',    role: 'executive',     module: 'bd',      city: 'Mumbai',    tenantId: 'bt-tenant-001' },
  { id: 'user_aman',   name: 'Aman Verma',     email: 'aman.verma@bluetokai.com',     role: 'executive',     module: 'bd',      city: 'New Delhi', tenantId: 'bt-tenant-001' },
  { id: 'user_nikhil', name: 'Nikhil Iyer',    email: 'nikhil.iyer@bluetokai.com',    role: 'executive',     module: 'bd',      city: 'Pune',      tenantId: 'bt-tenant-001' },
  { id: 'user_aisha',  name: 'Aisha Sengupta', email: 'aisha.sengupta@bluetokai.com', role: 'executive',     module: 'bd',      city: 'Bengaluru', tenantId: 'bt-tenant-001' },
  { id: 'user_sup1',   name: 'Nisha Kapoor',   email: 'nisha.kapoor@bluetokai.com',   role: 'supervisor',    module: 'bd',      city: 'Mumbai',    tenantId: 'bt-tenant-001' },
  { id: 'user_bizadmin', name: 'Dev Malhotra', email: 'dev.malhotra@bluetokai.com',   role: 'business_admin', module: null,     city: 'Mumbai',    tenantId: 'bt-tenant-001' },
];

export function getUserById(id) {
  return MOCK_USERS.find(u => u.id === id) || null;
}

export function getUserByEmail(email) {
  return MOCK_USERS.find(u => u.email === email) || null;
}
