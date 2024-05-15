
import * as dotenvexpand from 'dotenv-expand';
import * as dotenv from 'dotenv';
import {client} from './Client.js';

dotenvexpand.expand(dotenv.config());

export const getAdmin = (async () => client.users.fetch(process.env.ADMIN_USER_ID ?? ''));
