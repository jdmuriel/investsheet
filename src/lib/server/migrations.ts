/** Migraciones de esquema, en orden. No modificar una ya desplegada: añadir otra. */
export const MIGRATIONS: { version: number; sql: string }[] = [
	{
		version: 1,
		sql: `
-- Importes en céntimos enteros; acciones en millonésimas (1 acción = 1000000).
CREATE TABLE portfolio (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE account (
	id INTEGER PRIMARY KEY,
	portfolio_id INTEGER NOT NULL REFERENCES portfolio(id),
	code TEXT NOT NULL,
	name TEXT NOT NULL,
	broker TEXT,
	currency TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0,
	closed INTEGER NOT NULL DEFAULT 0,
	UNIQUE (portfolio_id, code)
);

CREATE TABLE security (
	id INTEGER PRIMARY KEY,
	ticker TEXT NOT NULL UNIQUE,
	price_ticker TEXT,
	name TEXT,
	country TEXT,
	currency TEXT,
	sector TEXT,
	supersector TEXT,
	zone TEXT,
	tier TEXT,
	wht_source_pct REAL,
	wht_dest_pct REAL,
	reinvest INTEGER NOT NULL DEFAULT 1,
	active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE operation (
	id INTEGER PRIMARY KEY,
	portfolio_id INTEGER NOT NULL REFERENCES portfolio(id),
	date TEXT NOT NULL,
	seq INTEGER NOT NULL,
	type TEXT NOT NULL,
	account_id INTEGER REFERENCES account(id),
	security_id INTEGER REFERENCES security(id),
	quantity REAL,
	price REAL,
	currency TEXT,
	fx_rate REAL,
	-- en la moneda de la operación
	amount_local INTEGER,
	tax_local INTEGER,
	wht_source_local INTEGER,
	wht_dest_local INTEGER,
	fees_local INTEGER,
	-- contravalor en euros, tal como se registró
	gross_eur INTEGER NOT NULL DEFAULT 0,
	tax_eur INTEGER NOT NULL DEFAULT 0,
	fees_eur INTEGER NOT NULL DEFAULT 0,
	capital_in_eur INTEGER NOT NULL DEFAULT 0,
	capital_out_eur INTEGER NOT NULL DEFAULT 0,
	purchase_eur INTEGER NOT NULL DEFAULT 0,
	description TEXT NOT NULL DEFAULT '',
	notes TEXT,
	source TEXT NOT NULL DEFAULT 'manual',
	legacy_ref TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX operation_order ON operation (portfolio_id, date, seq);

CREATE TABLE cash_leg (
	id INTEGER PRIMARY KEY,
	operation_id INTEGER NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
	account_id INTEGER NOT NULL REFERENCES account(id),
	amount INTEGER NOT NULL
);
CREATE INDEX cash_leg_operation ON cash_leg (operation_id);

CREATE TABLE position_leg (
	id INTEGER PRIMARY KEY,
	operation_id INTEGER NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
	security_id INTEGER NOT NULL REFERENCES security(id),
	kind TEXT NOT NULL CHECK (kind IN ('buy', 'sell', 'adjust', 'convert')),
	shares INTEGER NOT NULL DEFAULT 0,
	cost_eur INTEGER NOT NULL DEFAULT 0,
	reduced_cost_eur INTEGER NOT NULL DEFAULT 0,
	proceeds_eur INTEGER,
	to_security_id INTEGER REFERENCES security(id)
);
CREATE INDEX position_leg_operation ON position_leg (operation_id);

CREATE TABLE goal (
	portfolio_id INTEGER NOT NULL REFERENCES portfolio(id),
	year INTEGER NOT NULL,
	metric TEXT NOT NULL,
	amount_eur INTEGER NOT NULL,
	PRIMARY KEY (portfolio_id, year, metric)
);

CREATE TABLE setting (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE audit_log (
	id INTEGER PRIMARY KEY,
	at TEXT NOT NULL DEFAULT (datetime('now')),
	entity TEXT NOT NULL,
	entity_id INTEGER,
	action TEXT NOT NULL,
	before_json TEXT,
	after_json TEXT
);
`
	}
];
