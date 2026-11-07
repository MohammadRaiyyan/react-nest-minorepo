import { Test } from '@nestjs/testing';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('reports ok on /health', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    const result = moduleRef.get(AppController).health();
    expect(result.status).toBe('ok');
  });
});
