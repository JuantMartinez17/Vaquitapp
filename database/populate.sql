-- =====================================================
-- USERS
-- =====================================================

INSERT INTO users (username, email, password_hash) VALUES
('juan', 'juan@test.com', 'hash1'),
('ana', 'ana@test.com', 'hash2'),
('pedro', 'pedro@test.com', 'hash3'),
('lucia', 'lucia@test.com', 'hash4');

-- =====================================================
-- GROUPS
-- =====================================================

INSERT INTO groups (name, description, created_by) VALUES
('Viaje a Bariloche', 'Gastos del viaje de amigos', 8),
('Depto Compartido', 'Gastos mensuales del departamento', 9);

SELECT * FROM users

-- =====================================================
-- GROUP MEMBERS
-- =====================================================

-- Grupo 1: todos
INSERT INTO group_members (group_id, user_id) VALUES
(7, 8),
(7, 9),
(7, 10),
(7, 11);

-- Grupo 2: solo 3
INSERT INTO group_members (group_id, user_id) VALUES
(8, 9),
(8, 10),
(8, 11);

-- =====================================================
-- EXPENSES
-- =====================================================

-- Grupo 1
INSERT INTO expenses (group_id, paid_by, description, amount, expense_date)
VALUES
(7, 8, 'Alquiler auto', 120000.00, '2026-01-10'),
(7, 9, 'Cena restaurante', 40000.00, '2026-01-11'),
(7, 10, 'Combustible', 20000.00, '2026-01-12');

-- Grupo 2
INSERT INTO expenses (group_id, paid_by, description, amount, expense_date)
VALUES
(8, 11, 'Alquiler mensual', 300000.00, '2026-02-01'),
(8, 10, 'Supermercado', 90000.00, '2026-02-05');

-- =====================================================
-- EXPENSE SPLITS
-- IMPORTANTE: deben sumar EXACTAMENTE el amount
-- =====================================================

-- Gasto 1: 120000 / 4 = 30000 c/u
INSERT INTO expense_splits (expense_id, user_id, amount) VALUES
(3, 8, 30000.00),
(3, 9, 30000.00),
(3, 10, 30000.00),
(3, 11, 30000.00);



-- Gasto 2: 40000 / 4 = 10000 c/u
INSERT INTO expense_splits (expense_id, user_id, amount) VALUES
(4, 8, 10000.00),
(4, 9, 10000.00),
(4, 10, 10000.00),
(4, 11, 10000.00);

-- Gasto 3: 20000 / 4 = 5000 c/u
INSERT INTO expense_splits (expense_id, user_id, amount) VALUES
(5, 8, 5000.00),
(5, 9, 5000.00),
(5, 10, 5000.00),
(5, 11, 5000.00);