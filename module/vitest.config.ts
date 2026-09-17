import {defineConfig} from 'vitest/config';
export default defineConfig({esbuild:{jsx:'automatic'},test:{environment:'jsdom',include:['client/**/*.test.{ts,tsx}','tests/**/*.test.ts'],pool:'forks',poolOptions:{forks:{singleFork:true}}}});
