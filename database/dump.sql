-- =====================================================
-- CLEAN (solo para desarrollo)
-- =====================================================

DROP TABLE IF EXISTS expense_splits CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =====================================================
-- USERS
-- =====================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- GROUPS
-- =====================================================

CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- GROUP MEMBERS (N:N)
-- =====================================================

CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
);

-- =====================================================
-- EXPENSES (MEJORADO)
-- =====================================================

CREATE TABLE expenses (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    paid_by INTEGER NOT NULL REFERENCES users(id),
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),

    -- NUEVO: fecha del gasto (no siempre coincide con created_at)
    expense_date DATE DEFAULT CURRENT_DATE,

    -- NUEVO: estado del gasto
    status VARCHAR(20) DEFAULT 'active',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- EXPENSE SPLITS (MEJORADO)
-- =====================================================

CREATE TABLE expense_splits (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),

    -- NUEVO: evitar duplicados por gasto
    UNIQUE(expense_id, user_id)
);

-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX idx_groups_created_by ON groups(created_by);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_expenses_group_id ON expenses(group_id);
CREATE INDEX idx_expense_splits_expense_id ON expense_splits(expense_id);

-- =====================================================
-- VALIDACIÓN CLAVE (PRO LEVEL)
-- =====================================================

-- Esta función valida que la suma de splits = amount del gasto

CREATE OR REPLACE FUNCTION validate_expense_splits()
RETURNS TRIGGER AS $$
DECLARE
    total_splits DECIMAL(10,2);
    expense_total DECIMAL(10,2);
BEGIN
    -- Obtener total de splits
    SELECT COALESCE(SUM(amount), 0)
    INTO total_splits
    FROM expense_splits
    WHERE expense_id = NEW.expense_id;

    -- Obtener total del gasto
    SELECT amount
    INTO expense_total
    FROM expenses
    WHERE id = NEW.expense_id;

    -- Validar
    IF total_splits > expense_total THEN
        RAISE EXCEPTION 'La suma de los splits excede el monto del gasto';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger que se ejecuta al insertar o actualizar splits

CREATE TRIGGER trg_validate_splits
BEFORE INSERT OR UPDATE ON expense_splits
FOR EACH ROW
EXECUTE FUNCTION validate_expense_splits();