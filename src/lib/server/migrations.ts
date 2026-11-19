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
	},
	{
		version: 2,
		sql: `
-- Campos del formulario tal como se teclearon, para poder reeditar la operación.
ALTER TABLE operation ADD COLUMN input_json TEXT;
`
	},
	{
		version: 3,
		sql: `
-- Opciones: la prima pasa de contarse como compra a ser renta del año (negativa si se pagó),
-- con dos tipos genéricos en lugar de «venta de put» y «compra de call».
UPDATE operation SET type = CASE type WHEN 'VENTAPUT' THEN 'VENTAOPCION' ELSE 'COMPRAOPCION' END,
	gross_eur = gross_eur - purchase_eur, purchase_eur = 0, updated_at = datetime('now')
WHERE type IN ('VENTAPUT', 'COMPRACALL');
`
	},
	{
		version: 4,
		sql: `
-- Conciliación: saldo real de una cuenta según el broker en una fecha, junto al que calculaba la aplicación.
CREATE TABLE reconciliation (
	id INTEGER PRIMARY KEY,
	account_id INTEGER NOT NULL REFERENCES account(id),
	date TEXT NOT NULL,
	real_balance INTEGER NOT NULL,
	computed_balance INTEGER NOT NULL,
	notes TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX reconciliation_account ON reconciliation (account_id, date);
`
	},
	{
		version: 5,
		sql: `
-- La importación tomó por valores tres totales numéricos de la fila de tickers de «Control cartera».
-- Se borran los «valores» sin ninguna letra en el ticker que nadie usa.
DELETE FROM security
WHERE ticker NOT GLOB '*[A-Za-z]*'
	AND id NOT IN (SELECT security_id FROM operation WHERE security_id IS NOT NULL)
	AND id NOT IN (SELECT security_id FROM position_leg)
	AND id NOT IN (SELECT to_security_id FROM position_leg WHERE to_security_id IS NOT NULL);
`
	},
	{
		version: 6,
		sql: `
-- Fase 2: precios, tipos de cambio y dividendos previstos.
-- Precio de un valor en una fecha, en unidades de su moneda (los que cotizan en peniques se guardan en libras).
-- \`source\`: 'sheet' (hoja de precios), 'manual' (tecleado) o 'legacy' (hoja antigua).
CREATE TABLE price (
	security_id INTEGER NOT NULL REFERENCES security(id),
	date TEXT NOT NULL,
	price REAL NOT NULL,
	currency TEXT NOT NULL,
	source TEXT NOT NULL,
	fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (security_id, date)
);

-- Unidades de la moneda por euro, como en el resto de la aplicación. \`source\`: 'ecb' o 'legacy'.
CREATE TABLE fx_rate (
	currency TEXT NOT NULL,
	date TEXT NOT NULL,
	rate REAL NOT NULL,
	source TEXT NOT NULL DEFAULT 'ecb',
	PRIMARY KEY (currency, date)
);

-- Calendario de dividendos previstos, versionado: una fila por valor y fecha de entrada en vigor,
-- con el importe por acción de cada mes (de enero a diciembre) en \`months_json\`.
CREATE TABLE dividend_schedule (
	security_id INTEGER NOT NULL REFERENCES security(id),
	valid_from TEXT NOT NULL,
	currency TEXT NOT NULL,
	months_json TEXT NOT NULL,
	PRIMARY KEY (security_id, valid_from)
);

-- Cambio de dividendo: dividendo anual por acción antes y después, y el cambio de la moneda en esa fecha.
-- Las acciones y el efecto en euros no se guardan: se calculan por cartera a partir del registro.
CREATE TABLE dividend_change (
	id INTEGER PRIMARY KEY,
	security_id INTEGER NOT NULL REFERENCES security(id),
	date TEXT NOT NULL,
	old_annual REAL NOT NULL,
	new_annual REAL NOT NULL,
	currency TEXT NOT NULL,
	fx_rate REAL NOT NULL,
	url TEXT,
	note TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX dividend_change_date ON dividend_change (date);
`
	},
	{
		version: 7,
		sql: `
-- La importación duplicó algunas compras cuyo ticker tenía una errata: además del lote del valor en cuya
-- columna las anotó la hoja, creó otro igual a nombre del ticker tecleado. Se borra el lote sobrante
-- y la operación pasa a citar el valor bueno.
CREATE TEMP TABLE phantom_leg AS
SELECT l.id AS leg_id, l.operation_id, m.security_id AS real_security
FROM position_leg l
JOIN operation o ON o.id = l.operation_id AND o.source = 'legacy' AND o.security_id = l.security_id
JOIN position_leg m ON m.operation_id = l.operation_id AND m.id <> l.id AND m.kind = 'buy' AND m.security_id <> l.security_id AND m.shares = l.shares
WHERE l.kind = 'buy' AND (SELECT count(*) FROM position_leg x WHERE x.operation_id = l.operation_id) = 2;
UPDATE operation SET security_id = (SELECT real_security FROM phantom_leg WHERE operation_id = operation.id), updated_at = datetime('now')
WHERE id IN (SELECT operation_id FROM phantom_leg);
DELETE FROM position_leg WHERE id IN (SELECT leg_id FROM phantom_leg);
DROP TABLE phantom_leg;
`
		},
	{
		version: 8,
		sql: `
-- Orden por defecto de los valores de cada cartera en el cuadro (el de las columnas de \`Control cartera\`).
CREATE TABLE portfolio_security (
	portfolio_id INTEGER NOT NULL REFERENCES portfolio(id),
	security_id INTEGER NOT NULL REFERENCES security(id),
	sort_order INTEGER NOT NULL,
	PRIMARY KEY (portfolio_id, security_id)
);

-- Selección mensual (RF-31 a RF-36). Precio objetivo en la moneda del valor y, para los candidatos sin
-- calendario de dividendos, dividendo anual por acción estimado (también en su moneda).
ALTER TABLE security ADD COLUMN target_price REAL;
ALTER TABLE security ADD COLUMN dividend_estimate REAL;

-- Valores que entran en la selección de cada cartera y su posición dentro de su lista (la lista sale de zona y tier).
CREATE TABLE selection_entry (
	portfolio_id INTEGER NOT NULL REFERENCES portfolio(id),
	security_id INTEGER NOT NULL REFERENCES security(id),
	position INTEGER NOT NULL,
	PRIMARY KEY (portfolio_id, security_id)
);

-- Revisión cerrada: fecha, propuestas y elección del mes, y de cada valor su lista, posición y precio ese día.
CREATE TABLE selection_review (
	id INTEGER PRIMARY KEY,
	portfolio_id INTEGER NOT NULL REFERENCES portfolio(id),
	date TEXT NOT NULL,
	proposals TEXT,
	choice TEXT,
	source TEXT NOT NULL DEFAULT 'app',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (portfolio_id, date)
);
CREATE TABLE selection_review_item (
	review_id INTEGER NOT NULL REFERENCES selection_review(id) ON DELETE CASCADE,
	security_id INTEGER NOT NULL REFERENCES security(id),
	list TEXT,
	position INTEGER,
	price REAL NOT NULL,
	currency TEXT NOT NULL,
	PRIMARY KEY (review_id, security_id)
);
`
	}
];
