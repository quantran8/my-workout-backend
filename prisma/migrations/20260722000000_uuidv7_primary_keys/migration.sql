-- uuid_generate_v7(): time-ordered UUID (RFC 9562 v7).
--
-- Postgres < 18 has no built-in uuidv7(), so we implement it in plpgsql.
-- Layout: 48-bit big-endian unix_ts_ms | ver 7 | 12b rand_a | variant b10 | 62b rand_b.
-- Being time-ordered gives insert locality on the btree, which is the whole point
-- of choosing v7 over v4 for primary keys.
--
-- Randomness comes from gen_random_uuid() (Postgres core since 13) rather than
-- pgcrypto's gen_random_bytes(), so this needs no extension — on Supabase pgcrypto
-- lives in the `extensions` schema and is not always on the migration search_path.
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
DECLARE
  ts_millis bigint;
  uuid_bytes bytea;
BEGIN
  ts_millis := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  -- Take a v4 uuid purely as 16 random bytes, then overwrite the leading 6
  -- with the timestamp. int8send yields 8 big-endian bytes; bytes 3..8 are the
  -- low 48 bits we want (substring is 1-indexed, so FROM 3 drops the top two).
  uuid_bytes := overlay(
    uuid_send(gen_random_uuid())
    PLACING substring(int8send(ts_millis) FROM 3 FOR 6)
    FROM 1 FOR 6
  );

  -- byte 6 high nibble := 0111 (version 7), keep the low nibble random.
  uuid_bytes := set_byte(uuid_bytes, 6, 112 | (get_byte(uuid_bytes, 6) & 15));
  -- byte 8 high two bits := 10 (RFC 4122 variant), keep the low 6 bits random.
  uuid_bytes := set_byte(uuid_bytes, 8, 128 | (get_byte(uuid_bytes, 8) & 63));

  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;
