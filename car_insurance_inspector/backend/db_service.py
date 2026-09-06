import os
import logging
from typing import List, Dict, Any, Optional
from pymongo import MongoClient, DESCENDING
from pymongo.errors import PyMongoError

logger = logging.getLogger("db_service")

# Ensure reliable DNS SRV lookup on Linux systems
try:
    import dns.resolver
    custom_resolver = dns.resolver.Resolver(configure=True)
    custom_resolver.nameservers = ['8.8.8.8', '1.1.1.1'] + list(custom_resolver.nameservers)
    dns.resolver.default_resolver = custom_resolver
except Exception as e:
    logger.debug("Could not patch default DNS resolver: %s", e)

class MongoDatabaseService:
    def __init__(self):
        self.uri = os.getenv("MONGODB_URI", "")
        self.db_name = os.getenv("MONGODB_DB_NAME", "stremux_insurance")
        self.client: Optional[MongoClient] = None
        self.db = None
        self._init_connection()

    def _init_connection(self):
        try:
            self.client = MongoClient(
                self.uri,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                maxPoolSize=20
            )
            self.db = self.client[self.db_name]
            # Ensure index on inspection_id and created_at
            self.db.inspections.create_index("inspection_id", unique=True)
            self.db.inspections.create_index([("created_at", DESCENDING)])
            logger.info("Successfully connected to MongoDB Atlas: %s", self.db_name)
        except Exception as e:
            logger.error("Failed to connect to MongoDB Atlas: %s", e)

    def ping(self) -> Dict[str, Any]:
        if not self.client:
            return {"status": "error", "message": "MongoDB client not initialized"}
        try:
            self.client.admin.command('ping')
            return {"status": "connected", "database": self.db_name}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def save_inspection(self, data: Dict[str, Any]) -> bool:
        if self.db is None:
            self._init_connection()
        if self.db is None:
            raise RuntimeError("Database connection not available")

        try:
            self.db.inspections.update_one(
                {"inspection_id": data["inspection_id"]},
                {"$set": data},
                upsert=True
            )
            return True
        except PyMongoError as e:
            logger.error("Error saving inspection: %s", e)
            raise

    def get_inspections(
        self,
        limit: int = 50,
        skip: int = 0,
        query: Optional[str] = None,
        severity_filter: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        if self.db is None:
            self._init_connection()
        if self.db is None:
            return []

        filter_dict: Dict[str, Any] = {}
        if query:
            filter_dict["$or"] = [
                {"inspection_id": {"$regex": query, "$options": "i"}},
                {"vehicle_title": {"$regex": query, "$options": "i"}},
                {"license_plate": {"$regex": query, "$options": "i"}},
            ]
        if severity_filter and severity_filter.lower() != "all":
            filter_dict["report.damage_classification"] = {"$regex": severity_filter, "$options": "i"}

        # Projection: exclude heavy photo binaries for list view
        projection = {
            "photos.front.image_b64": 0,
            "photos.rear.image_b64": 0,
            "photos.left.image_b64": 0,
            "photos.right.image_b64": 0,
            "_id": 0
        }

        try:
            cursor = (
                self.db.inspections.find(filter_dict, projection)
                .sort("created_at", DESCENDING)
                .skip(skip)
                .limit(limit)
            )
            return list(cursor)
        except PyMongoError as e:
            logger.error("Error fetching inspections: %s", e)
            return []

    def get_inspection_by_id(self, inspection_id: str) -> Optional[Dict[str, Any]]:
        if self.db is None:
            self._init_connection()
        if self.db is None:
            return None

        try:
            doc = self.db.inspections.find_one({"inspection_id": inspection_id}, {"_id": 0})
            return doc
        except PyMongoError as e:
            logger.error("Error fetching inspection %s: %s", inspection_id, e)
            return None

    def delete_inspection(self, inspection_id: str) -> bool:
        if self.db is None:
            self._init_connection()
        if self.db is None:
            return False

        try:
            res = self.db.inspections.delete_one({"inspection_id": inspection_id})
            return res.deleted_count > 0
        except PyMongoError as e:
            logger.error("Error deleting inspection %s: %s", inspection_id, e)
            return False

# Singleton instance
db_service = MongoDatabaseService()
