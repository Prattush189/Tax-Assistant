import crypto from 'crypto';
import db from '../index.js';

export interface TaxProfile {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  fy: string;
  gross_salary: string;
  other_income: string;
  age_category: string;
  deductions_data: string;  // JSON
  hra_data: string;         // JSON
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare('SELECT * FROM tax_profiles WHERE user_id = ? ORDER BY updated_at DESC'),
  findById: db.prepare('SELECT * FROM tax_profiles WHERE id = ?'),
  countByUser: db.prepare('SELECT COUNT(*) as count FROM tax_profiles WHERE user_id = ?'),
  countByBillingUser: db.prepare('SELECT COUNT(*) as count FROM tax_profiles WHERE billing_user_id = ?'),
  create: db.prepare(
    'INSERT INTO tax_profiles (id, user_id, billing_user_id, name, description, fy, gross_salary, other_income, age_category, deductions_data, hra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  update: db.prepare(
    "UPDATE tax_profiles SET name = ?, description = ?, fy = ?, gross_salary = ?, other_income = ?, age_category = ?, deductions_data = ?, hra_data = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  deleteById: db.prepare('DELETE FROM tax_profiles WHERE id = ? AND user_id = ?'),
};

export const profileRepo = {
  findByUserId(userId: string): TaxProfile[] {
    return stmts.findByUserId.all(userId) as TaxProfile[];
  },

  findById(id: string): TaxProfile | undefined {
    return stmts.findById.get(id) as TaxProfile | undefined;
  },

  countByUser(userId: string): number {
    return (stmts.countByUser.get(userId) as { count: number }).count;
  },

  countByBillingUser(billingUserId: string): number {
    return (stmts.countByBillingUser.get(billingUserId) as { count: number }).count;
  },

  create(
    userId: string,
    name: string,
    description: string | null,
    data: { fy: string; gross_salary: string; other_income: string; age_category: string; deductions_data: string; hra_data: string },
    billingUserId?: string,
  ): TaxProfile {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(
      id,
      userId,
      billingUserId ?? userId,
      name,
      description,
      data.fy,
      data.gross_salary,
      data.other_income,
      data.age_category,
      data.deductions_data,
      data.hra_data,
    );
    return this.findById(id)!;
  },

  update(id: string, data: Partial<Omit<TaxProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): void {
    const current = this.findById(id);
    if (!current) return;
    stmts.update.run(
      data.name ?? current.name,
      data.description ?? current.description,
      data.fy ?? current.fy,
      data.gross_salary ?? current.gross_salary,
      data.other_income ?? current.other_income,
      data.age_category ?? current.age_category,
      data.deductions_data ?? current.deductions_data,
      data.hra_data ?? current.hra_data,
      id,
    );
  },

  deleteById(id: string, userId: string): boolean {
    const result = stmts.deleteById.run(id, userId);
    return result.changes > 0;
  },
};
