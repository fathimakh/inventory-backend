// model/inventoryData.js - Array-based in-memory model
//
// All inventory data lives in the `inventory` array below, in runtime memory.
// There is no database and nothing is written to disk, so the data resets
// every time the server restarts (by design for this assignment).
//
// Item shape:
// {
//   id: 1,                       // auto-increment number, never reused
//   name: 'Wireless Mouse',      // unique (case-insensitive)
//   category: 'Electronics',
//   quantity: 45,                // integer >= 0
//   price: 799,                  // number >= 0
//   supplier: 'Logitech' | null, // optional
//   createdAt: '2026-01-01T10:00:00.000Z',
//   updatedAt: '2026-01-01T10:00:00.000Z'
// }

let inventory = [];
let nextId = 1; // incremented on every insert, so deleted ids are never reused

// Sample data so the API can be explored right after `npm run dev`
const SAMPLE_ITEMS = [
  { name: 'Wireless Mouse', category: 'Electronics', quantity: 45, price: 799, supplier: 'Logitech' },
  { name: 'Mechanical Keyboard', category: 'Electronics', quantity: 12, price: 3499, supplier: 'Keychron' },
  { name: 'USB-C Charger 65W', category: 'Electronics', quantity: 0, price: 1999, supplier: 'Anker' },
  { name: 'Office Chair', category: 'Furniture', quantity: 8, price: 7499, supplier: 'Green Soul' },
  { name: 'Standing Desk', category: 'Furniture', quantity: 3, price: 18999, supplier: 'Featherlite' },
  { name: 'A4 Notebook', category: 'Stationery', quantity: 150, price: 120, supplier: 'Classmate' },
  { name: 'Blue Ballpoint Pen (Pack of 10)', category: 'Stationery', quantity: 300, price: 100, supplier: 'Reynolds' },
  { name: 'Whiteboard Marker Set', category: 'Stationery', quantity: 5, price: 249, supplier: null },
];

// ---------- Internal helpers ----------

// Callers always receive copies, so nobody can change the array by accident
const clone = (item) => ({ ...item });

const normalize = (text) => String(text).trim().toLowerCase();

const findIndexById = (id) => inventory.findIndex((item) => item.id === id);

// Copy only the known item fields (ignores anything else on the input object)
const pickItemFields = ({ name, category, quantity, price, supplier }) => {
  const fields = { name, category, quantity, price, supplier };
  Object.keys(fields).forEach((key) => fields[key] === undefined && delete fields[key]);
  return fields;
};

// ---------- Read ----------

/** Returns a copy of every item, in insertion order. */
const findAll = () => inventory.map(clone);

/** Returns the item with the given id, or null if it does not exist. */
const findById = (id) => {
  const item = inventory.find((entry) => entry.id === id);
  return item ? clone(item) : null;
};

/**
 * Case-insensitive lookup by exact name. `excludeId` skips one item, which
 * lets an item keep its own name when it is updated.
 */
const findByName = (name, excludeId = null) => {
  const target = normalize(name);
  const item = inventory.find((entry) => entry.id !== excludeId && normalize(entry.name) === target);
  return item ? clone(item) : null;
};

/** Number of items currently stored. */
const count = () => inventory.length;

// ---------- Create ----------

/** Pushes a new item onto the array and returns a copy of it. */
const create = (data) => {
  const now = new Date().toISOString();
  const { name, category, quantity, price, supplier = null } = pickItemFields(data);

  const item = {
    id: nextId++,
    name,
    category,
    quantity,
    price,
    supplier,
    createdAt: now,
    updatedAt: now,
  };

  inventory.push(item);
  return clone(item);
};

// ---------- Update ----------

/**
 * Full replacement (PUT). Every editable field is overwritten; optional
 * fields that are not supplied are reset. id and createdAt are preserved.
 * Returns the updated item, or null if the id does not exist.
 */
const replace = (id, data) => {
  const index = findIndexById(id);
  if (index === -1) return null;

  const { name, category, quantity, price, supplier = null } = pickItemFields(data);
  const existing = inventory[index];

  inventory[index] = {
    id: existing.id,
    name,
    category,
    quantity,
    price,
    supplier,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return clone(inventory[index]);
};

/**
 * Partial update (PATCH). Only the supplied fields change.
 * Returns the updated item, or null if the id does not exist.
 */
const update = (id, changes) => {
  const index = findIndexById(id);
  if (index === -1) return null;

  // Build a new object instead of mutating the stored one in place
  inventory[index] = {
    ...inventory[index],
    ...pickItemFields(changes),
    id: inventory[index].id, // id and createdAt can never change
    createdAt: inventory[index].createdAt,
    updatedAt: new Date().toISOString(),
  };
  return clone(inventory[index]);
};

// ---------- Delete ----------

/** Removes the item from the array. Returns the removed item, or null if not found. */
const remove = (id) => {
  const index = findIndexById(id);
  if (index === -1) return null;

  const [removed] = inventory.splice(index, 1);
  return clone(removed);
};

// ---------- Setup ----------

/** Clears the array and restarts ids from 1. */
const reset = () => {
  inventory = [];
  nextId = 1;
};

/** Loads the sample items into an empty store. Returns how many were added. */
const seed = () => {
  reset();
  SAMPLE_ITEMS.forEach((item) => create(item));
  return inventory.length;
};

module.exports = {
  findAll,
  findById,
  findByName,
  count,
  create,
  replace,
  update,
  remove,
  reset,
  seed,
};
