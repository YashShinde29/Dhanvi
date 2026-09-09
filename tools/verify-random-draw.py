#!/usr/bin/env python3
"""Independent DHANVI_RANDOM_V1 verifier; accepts endpoint JSON or its proof object."""
import hashlib
import json
import sys
import uuid

ALGORITHM = "DHANVI_RANDOM_V1"

def sha(value):
    return hashlib.sha256(value).hexdigest()

def verify(document):
    p = document.get("proof", document)
    if p["algorithmVersion"] != ALGORITHM:
        raise ValueError("unsupported algorithm version")
    group = str(uuid.UUID(p["groupId"]))
    cycle = str(uuid.UUID(p["cycleId"]))
    if uuid.UUID(group).int == 0 or uuid.UUID(cycle).int == 0:
        raise ValueError("empty group/cycle UUID")
    number = p["cycleNumber"]
    members = p["canonicalEligibleMembers"]
    if type(number) is not int or not 1 <= number <= 50 or not 1 <= len(members) <= 50:
        raise ValueError("invalid cycle/member count")
    canonical = [(str(uuid.UUID(m["membershipId"])), m["slotNumber"]) for m in members]
    if any(uuid.UUID(member).int == 0 for member, _ in canonical):
        raise ValueError("empty membership UUID")
    if type(p["selectedIndex"]) is not int:
        raise ValueError("invalid selected index")
    if any(type(slot) is not int or not 1 <= slot <= 50 for _, slot in canonical):
        raise ValueError("invalid slot")
    if canonical != sorted(canonical, key=lambda item: item[1]) or len({m for m, _ in canonical}) != len(canonical) or len({s for _, s in canonical}) != len(canonical):
        raise ValueError("snapshot is not canonical and unique")
    payload = f"{ALGORITHM}\n{group}\n{cycle}\n{number}\n" + "".join(f"{member}:{slot}\n" for member, slot in canonical)
    eligible_hash = sha(payload.encode("utf-8"))
    seed = bytes.fromhex(p["seedReveal"])
    if len(seed) != 32 or seed.hex() != p["seedReveal"]:
        raise ValueError("invalid canonical seed")
    commitment = sha(seed)
    if eligible_hash != p["eligibleSetHash"] or commitment != p["seedCommitment"]:
        raise ValueError("eligible hash or seed commitment mismatch")
    count = len(canonical)
    threshold = (1 << 64) % count
    counter = 0
    while True:
        context = f"{ALGORITHM}\n{group}\n{cycle}\n{number}\n{eligible_hash}\n{counter}\n".encode("utf-8")
        candidate = int.from_bytes(hashlib.sha256(seed + context).digest()[:8], "big")
        if candidate >= threshold:
            index = candidate % count
            break
        counter += 1
        if counter > (1 << 64) - 1:
            raise ValueError("counter exhausted")
    winner = canonical[index][0]
    result_payload = f"DHANVI_RANDOM_RESULT_V1\n{ALGORITHM}\n{group}\n{cycle}\n{number}\n{eligible_hash}\n{commitment}\n{seed.hex()}\n{index}\n{winner}\n"
    if index != p["selectedIndex"] or winner != p["winnerMembershipId"] or sha(result_payload.encode("utf-8")) != p["resultHash"]:
        raise ValueError("winner, index, or result hash mismatch")
    return {"valid": True, "selectedIndex": index, "winnerMembershipId": winner}

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] != "-":
            with open(sys.argv[1], encoding="utf-8") as stream:
                document = json.load(stream)
        else:
            document = json.load(sys.stdin)
        print(json.dumps(verify(document)))
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({"valid": False, "failureReason": str(error)}))
        sys.exit(1)
