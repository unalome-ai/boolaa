#!/usr/bin/env python3
"""Prints SQL that loads (or removes) the marketing-screenshot data in the LOCAL Supabase.

    seed.py <en|ro|fr|es|it>   SQL that replaces the marketing data with that language's content
    seed.py --cleanup          SQL that deletes everything this script ever adds
    seed.py --get <locale> <key>   prints one value (flat name, invite code) for the capture script

All rows hang off six fictional users (mk-*@boolaa.test) and three bubbles with fixed ids, so the
seeded Alice/Bob/Carol data that the test suites rely on is never touched. Ids are chosen for their
colour (docs/design-system.md, 2.3): the flat is sky, the climbing bubble tangerine, the book club pink.
"""
import json, sys
from datetime import datetime, timedelta
from pathlib import Path

CONTENT = json.loads((Path(__file__).parent / "content.json").read_text())
PASSWORD = "password123"  # same as the seeded local logins
INVITE_CODE = "ROSE4B26"

USERS = {  # key -> (uuid suffix, display name); avatar colours: sunny, coral, mint, sky, pink, tangerine
    "alice": ("01", "Alice"), "bob": ("02", "Bob"), "carol": ("07", "Carol"),
    "dan": ("04", "Dan"), "erin": ("06", "Erin"), "finn": ("03", "Finn"),
}
BUBBLES = {"flat": "06", "climb": "01", "books": "08"}
MEMBERS = {  # first member is the owner
    "flat": ["alice", "bob", "carol", "dan"],
    "climb": ["bob", "alice", "dan"],
    "books": ["carol", "alice"],
}

def uid(key): return f"c0ffee00-0000-4000-8000-0000000000{USERS[key][0]}"
def bid(key): return f"b00b1e00-0000-4000-8000-0000000000{BUBBLES[key]}"
def q(value): return "null" if value is None else "'" + str(value).replace("'", "''") + "'"
def arr(values): return "'{" + ",".join(values) + "}'"
def ago(minutes): return q((datetime.now().astimezone() - timedelta(minutes=minutes)).isoformat())

def upcoming(weekday, hour, minute, min_days=1):
    """The next <weekday> (0 = Monday) at hh:mm local time, at least min_days away."""
    day = datetime.now().astimezone().replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=min_days)
    while day.weekday() != weekday: day += timedelta(days=1)
    return q(day.isoformat())

def cleanup():
    ids = ",".join(q(uid(k)) for k in USERS)
    return [
        f"delete from public.bubbles where id in ({','.join(q(bid(k)) for k in BUBBLES)});",
        f"delete from auth.users where id in ({ids});",  # cascades to public.users and everything they own
    ]

def seed(locale):
    c, photos = CONTENT["locales"][locale], CONTENT["photos"]
    out = cleanup()
    for key, (_, name) in USERS.items():
        out.append(
            "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, "
            "raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, "
            "email_change, email_change_token_new) values ('00000000-0000-0000-0000-000000000000', "
            f"{q(uid(key))}, 'authenticated', 'authenticated', 'mk-{key}@boolaa.test', "
            f"crypt({q(PASSWORD)}, gen_salt('bf')), now(), '{{\"provider\":\"email\",\"providers\":[\"email\"]}}', "
            f"{q(json.dumps({'name': name}))}, now(), now(), '', '', '', '');")
        out.append(
            "insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) "
            f"values (gen_random_uuid(), {q(uid(key))}, {q(uid(key))}, "
            f"jsonb_build_object('sub', {q(uid(key))}, 'email', 'mk-{key}@boolaa.test', 'email_verified', true), 'email', now(), now(), now());")
        # The profile row normally comes from the sign-up trigger; make sure of the name either way.
        out.append(f"insert into public.users (id, name) values ({q(uid(key))}, {q(name)}) on conflict (id) do update set name = excluded.name;")
    out.append("update public.users set age_confirmed_at = now() where id in (%s);" % ",".join(q(uid(k)) for k in USERS))

    for i, key in enumerate(BUBBLES):
        name, description = c[key]
        owner = MEMBERS[key][0]
        code = INVITE_CODE if key == "flat" else f"MKT{key.upper()}"
        out.append(
            "insert into public.bubbles (id, name, description, max_size, invite_code, created_by, created_at) values "
            f"({q(bid(key))}, {q(name)}, {q(description)}, {8 if key == 'flat' else 12}, {q(code)}, {q(uid(owner))}, {ago(60 * 24 * (40 - i))});")
        for j, member in enumerate(MEMBERS[key]):
            out.append(
                "insert into public.bubble_members (user_id, bubble_id, approved, role, created_at) values "
                f"({q(uid(member))}, {q(bid(key))}, true, {q('owner' if j == 0 else 'member')}, {ago(60 * 24 * (40 - i) - j)});")

    flat = q(bid("flat"))
    # Erin asked to join the flat; Bob and Carol said yes, so Alice's vote makes the majority (3 of 4).
    out.append(f"insert into public.join_requests (user_id, bubble_id, approver_ids, created_at) values "
               f"({q(uid('erin'))}, {flat}, {arr([uid('bob'), uid('carol')])}, {ago(25)});")

    chat_minutes = [190, 187, 171, 96, 93, 52, 6]
    for (who, text), minutes in zip(c["chat"], chat_minutes):
        out.append(f"insert into public.chat_messages (bubble_id, sender_id, content, created_at) values ({flat}, {q(uid(who))}, {q(text)}, {ago(minutes)});")

    events = [  # creator, when, who is going, posted minutes ago
        ("alice", upcoming(4, 19, 30, 2), ["alice", "bob", "carol"], 21),
        ("dan", upcoming(2, 20, 0, 7), ["dan", "bob"], 60 * 26),
        ("carol", upcoming(6, 10, 0, 5), ["carol"], 60 * 50),
    ]
    for (title, description, place), (creator, when, going, minutes) in zip(c["events"], events):
        out.append("insert into public.events (bubble_id, creator_id, title, description, datetime, location, rsvp_list, created_at) values "
                   f"({flat}, {q(uid(creator))}, {q(title)}, {q(description)}, {when}, {q(place)}, {arr([uid(g) for g in going])}, {ago(minutes)});")

    for text, (who, photo, minutes) in zip(c["food"], [("alice", "cookies", 38), ("carol", "bread", 60 * 5), ("dan", "couscous", 98)]):
        out.append(f"insert into public.food_posts (bubble_id, user_id, image, description, created_at) values ({flat}, {q(uid(who))}, {q(photos[photo])}, {q(text)}, {ago(minutes)});")

    market = [("alice", "armchair", "free", 75), ("dan", "bike", "trade", 60 * 7), ("carol", "plant", "free", 60 * 22),
              ("bob", "books", "trade", 60 * 30), ("alice", "mugs", "free", 60 * 49)]
    for (title, description), (who, photo, status, minutes) in zip(c["market"], market):
        out.append("insert into public.market_items (bubble_id, owner_id, image, title, description, status, created_at) values "
                   f"({flat}, {q(uid(who))}, {q(photos[photo])}, {q(title)}, {q(description)}, {q(status)}, {ago(minutes)});")

    links = [("carol", "https://en.wikibooks.org/wiki/Cookbook:Pizza_Dough", 168), ("dan", "https://www.openstreetmap.org/", 60 * 28),
             ("bob", "https://en.wikipedia.org/wiki/Houseplant", 60 * 53)]
    for (title, tags), (who, url, minutes) in zip(c["links"], links):
        out.append(f"insert into public.shared_links (bubble_id, user_id, url, title, tags, created_at) values ({flat}, {q(uid(who))}, {q(url)}, {q(title)}, {arr(tags)}, {ago(minutes)});")

    message, event, place, book = c["other"]
    out.append(f"insert into public.chat_messages (bubble_id, sender_id, content, created_at) values ({q(bid('climb'))}, {q(uid('bob'))}, {q(message)}, {ago(45)});")
    out.append("insert into public.events (bubble_id, creator_id, title, datetime, location, rsvp_list) values "
               f"({q(bid('climb'))}, {q(uid('bob'))}, {q(event)}, {upcoming(1, 18, 30)}, {q(place)}, {arr([uid('bob'), uid('dan')])});")
    out.append(f"insert into public.chat_messages (bubble_id, sender_id, content, created_at) values ({q(bid('books'))}, {q(uid('carol'))}, {q(book)}, {ago(300)});")
    return out

if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--get"]:
        print({"flat": CONTENT["locales"][args[1]]["flat"][0], "flat-description": CONTENT["locales"][args[1]]["flat"][1],
               "code": INVITE_CODE}[args[2]])
    elif args == ["--cleanup"]:
        print("begin;\n" + "\n".join(cleanup()) + "\ncommit;")
    elif len(args) == 1 and args[0] in CONTENT["locales"]:
        print("begin;\n" + "\n".join(seed(args[0])) + "\ncommit;")
    else:
        sys.exit(__doc__)
