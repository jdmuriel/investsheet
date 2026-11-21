import { describe, expect, it } from 'vitest';
import { scheduleBefore } from './dividends.ts';

describe('calendario anterior a una fecha', () => {
	const versions = [{ validFrom: '2030-06-01' }, { validFrom: '2030-01-01' }];
	it('es el vigente en esa fecha', () => {
		expect(scheduleBefore(versions, '2030-03-01')).toEqual({ validFrom: '2030-01-01' });
		expect(scheduleBefore(versions, '2030-06-01')).toEqual({ validFrom: '2030-06-01' });
	});
	it('si la fecha es anterior a todos, el primero; sin versiones, ninguno', () => {
		expect(scheduleBefore(versions, '2029-12-01')).toEqual({ validFrom: '2030-01-01' });
		expect(scheduleBefore([], '2030-01-01')).toBeNull();
	});
});
