import { build } from '../_shared/wire.ts';

declare const Deno: any;

Deno.serve(build().submitOrder);
