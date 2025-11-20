import * as assert from 'assert';
import { validateConfig } from '../config';

suite('Config Test Suite', () => {
    test('validateConfig should return false for empty path', () => {
        const config = { 
            workshopPath: '', 
            opacity: 0.5,
            serverPort: 23333,
            customJs: '',
            wallpaperId: '',
            resizeDelay: 500,
            startupCheckInterval: 300
        };
        const result = validateConfig(config);
        assert.strictEqual(result, false);
    });
});
